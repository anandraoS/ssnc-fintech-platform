import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { startWith } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { IdempotencyKeys } from '../../core/idempotency';
import { Account, ApiProblem, SubmitTransactionRequest, Transaction, TransactionType, isApiProblem } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { StatusChipComponent } from '../../shared/status-chip.component';

export const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;

/** Cross-field rules mirroring the server's structural validation (the server remains the authority). */
export function transactionShapeValidator(group: AbstractControl): ValidationErrors | null {
  const type = group.get('type')?.value as TransactionType;
  const source = group.get('sourceAccountId')?.value as string;
  const target = group.get('targetAccountId')?.value as string;
  const errors: ValidationErrors = {};
  if (type === 'DEPOSIT' && !target) {
    errors['targetRequired'] = true;
  }
  if (type === 'WITHDRAWAL' && !source) {
    errors['sourceRequired'] = true;
  }
  if (type === 'TRANSFER') {
    if (!source || !target) {
      errors['bothRequired'] = true;
    } else if (source === target) {
      errors['sameAccount'] = true;
    }
  }
  return Object.keys(errors).length ? errors : null;
}

@Component({
  selector: 'app-transaction-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MoneyPipe, ReactiveFormsModule, RouterLink, StatusChipComponent],
  template: `
    <section class="page">
      <h1>New transaction</h1>
      <p class="subtitle">Deposits, withdrawals and transfers between accounts. Synthetic money only.</p>

      <div class="layout">
        <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate aria-labelledby="form-title">
          <h2 id="form-title" class="sr-only">Transaction details</h2>

          <mat-form-field appearance="outline">
            <mat-label>Type</mat-label>
            <mat-select formControlName="type" (selectionChange)="onTypeChange()">
              <mat-option value="DEPOSIT">Deposit</mat-option>
              <mat-option value="WITHDRAWAL">Withdrawal</mat-option>
              <mat-option value="TRANSFER">Transfer between accounts</mat-option>
            </mat-select>
          </mat-form-field>

          @if (type() !== 'DEPOSIT') {
            <mat-form-field appearance="outline">
              <mat-label>From account</mat-label>
              <mat-select formControlName="sourceAccountId" required>
                @for (a of usable(); track a.id) { <mat-option [value]="a.id">{{ a.accountNumber }} · {{ a.currency }} · {{ a.availableBalance | money: a.currency }} available</mat-option> }
              </mat-select>
            </mat-form-field>
          }
          @if (type() !== 'WITHDRAWAL') {
            <mat-form-field appearance="outline">
              <mat-label>To account</mat-label>
              <mat-select formControlName="targetAccountId" required>
                @for (a of usable(); track a.id) { <mat-option [value]="a.id">{{ a.accountNumber }} · {{ a.currency }}</mat-option> }
              </mat-select>
            </mat-form-field>
          }

          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Amount ({{ currency() || 'currency' }})</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" autocomplete="off" required aria-describedby="amount-hint" />
            <mat-hint id="amount-hint">Up to 2 decimal places, e.g. 125.50</mat-hint>
            @if (form.controls.amount.touched && form.controls.amount.errors; as err) {
              <mat-error>@if (err['required']) { Amount is required } @else if (err['pattern']) { Enter a positive amount with at most 2 decimals } @else { Amount must be greater than zero }</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Memo (optional)</mat-label>
            <input matInput formControlName="memo" maxlength="140" />
            @if (form.controls.memo.invalid) { <mat-error>Letters, digits and basic punctuation only</mat-error> }
          </mat-form-field>

          @if (shapeError(); as msg) {
            <p class="error" role="alert">{{ msg }}</p>
          }

          <button mat-flat-button type="submit" [disabled]="busy()">{{ busy() ? 'Submitting…' : 'Submit transaction' }}</button>
          <p class="muted small">Retrying after an error is safe: the same request reuses one idempotency key, so it can never be applied twice.</p>
        </form>

        <div aria-live="polite" class="result">
          @switch (outcome().kind) {
            @case ('accepted') {
              <div class="card ok" role="status">
                <h2>Accepted</h2>
                @if (outcome().tx; as tx) {
                  <p><a [routerLink]="['/transactions', tx.id]" class="mono">{{ tx.reference }}</a> <app-status-chip [status]="tx.status" /></p>
                  <p>{{ tx.amount | money: tx.currency }} · {{ tx.type }}</p>
                  @if (tx.status === 'PENDING_REVIEW') { <p>This amount needs approval by a second operator before it is processed.</p> }
                  @else { <p class="muted">Processing is asynchronous: open the transaction to follow its status.</p> }
                }
                @if (outcome().replayed) { <p class="muted">This was a repeat of an earlier identical submission - no second transaction was created.</p> }
              </div>
            }
            @case ('rejected') {
              <div class="card bad" role="alert">
                <h2>Rejected by business rules</h2>
                <p class="mono">{{ rejection()['failureCode'] }}</p>
                <p>{{ rejection()['failureDetail'] }}</p>
                @if (rejectedId(); as rid) {
                  <p><a [routerLink]="['/transactions', rid]">View the recorded transaction</a></p>
                }
              </div>
            }
            @case ('error') {
              <div class="card bad" role="alert">
                <h2>Could not submit</h2>
                <p>{{ outcome().problem?.message }}</p>
                @for (v of outcome().problem?.violations ?? []; track v.field) { <p class="small">{{ v.field }}: {{ v.message }}</p> }
                @if (outcome().problem?.correlationId) { <p class="muted small">Reference for support: <span class="mono">{{ outcome().problem?.correlationId }}</span></p> }
              </div>
            }
          }
        </div>
      </div>
    </section>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(300px, 520px) minmax(260px, 1fr); gap: 20px; align-items: start; }
    @media (max-width: 899px) { .layout { grid-template-columns: 1fr; } }
    form { display: flex; flex-direction: column; gap: 14px; }
    .error { color: var(--bad); margin: 0 0 8px; }
    .small { font-size: 12.5px; }
    .ok { border-color: #9fd6cf; background: #f2faf8; }
    .bad { border-color: #f1b3ae; background: #fdf5f4; }
    h2 { font-size: 16px; margin: 0 0 8px; }
  `,
})
export class TransactionNewComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly keys = new IdempotencyKeys();

  /** Optional ?account= query parameter used by the "New transaction" button on an account page. */
  readonly account = input<string>();

  protected readonly accounts = signal<Account[]>([]);
  protected readonly busy = signal(false);
  protected readonly outcome = signal<{ kind: 'none' | 'accepted' | 'rejected' | 'error'; tx?: Transaction; replayed?: boolean; problem?: ApiProblem }>({ kind: 'none' });

  protected readonly form = this.fb.nonNullable.group({
    type: 'DEPOSIT' as TransactionType,
    sourceAccountId: '',
    targetAccountId: '',
    amount: ['', [Validators.required, Validators.pattern(AMOUNT_PATTERN), (c: AbstractControl) => (c.value && Number(c.value) === 0 ? { zero: true } : null)]],
    memo: ['', [Validators.maxLength(140), Validators.pattern(/^[\p{L}\p{N} .,:;'()/#_-]*$/u)]],
  }, { validators: transactionShapeValidator });

  private readonly formValue = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), { initialValue: this.form.getRawValue() });
  protected readonly type = computed(() => this.formValue().type as TransactionType);
  protected readonly usable = computed(() => this.accounts().filter((a) => a.status === 'ACTIVE'));
  protected readonly currency = computed(() => {
    const v = this.formValue();
    const id = v.type === 'DEPOSIT' ? v.targetAccountId : v.sourceAccountId;
    return this.accounts().find((a) => a.id === id)?.currency ?? '';
  });
  protected readonly rejection = computed<Record<string, unknown>>(() => this.outcome().problem?.details ?? {});
  protected readonly rejectedId = computed(() => {
    const id = this.rejection()['transactionId'];
    return typeof id === 'string' ? id : '';
  });
  protected readonly shapeError = computed(() => {
    this.formValue();
    const e = this.form.errors;
    if (!e || !(this.form.touched || this.form.dirty)) {
      return '';
    }
    return e['targetRequired'] ? 'Choose the account to deposit into.' : e['sourceRequired'] ? 'Choose the account to withdraw from.'
      : e['bothRequired'] ? 'Choose both the source and the target account.' : e['sameAccount'] ? 'The source and target accounts must be different.' : '';
  });

  constructor() {
    this.api.accounts({ size: 100, sort: 'openedAt,asc' }).subscribe({
      next: (r) => {
        this.accounts.set(r.items);
        const preset = this.account();
        if (preset && r.items.some((a) => a.id === preset)) {
          this.form.patchValue({ targetAccountId: preset, sourceAccountId: preset });
        }
      },
      error: () => this.outcome.set({ kind: 'error', problem: { status: 0, code: 'ACCOUNTS_UNAVAILABLE', message: 'Your accounts could not be loaded, so a transaction cannot be created right now.', violations: [], details: {} } }),
    });
  }

  protected onTypeChange(): void {
    const t = this.form.controls.type.value;
    if (t === 'DEPOSIT') {
      this.form.patchValue({ sourceAccountId: '' });
    } else if (t === 'WITHDRAWAL') {
      this.form.patchValue({ targetAccountId: '' });
    }
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    this.form.markAsDirty();
    if (this.form.invalid || this.busy()) {
      return;
    }
    const v = this.form.getRawValue();
    const body: SubmitTransactionRequest = {
      type: v.type,
      sourceAccountId: v.type === 'DEPOSIT' ? undefined : v.sourceAccountId,
      targetAccountId: v.type === 'WITHDRAWAL' ? undefined : v.targetAccountId,
      amount: v.amount,
      currency: this.currency(),
      memo: v.memo.trim() || undefined,
    };
    const key = this.keys.keyFor(body);
    this.busy.set(true);
    this.outcome.set({ kind: 'none' });
    this.api.submit(body, key).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.keys.reset();
        this.outcome.set({ kind: 'accepted', tx: res.body ?? undefined, replayed: res.headers.get('Idempotent-Replayed') === 'true' });
        this.form.reset({ type: v.type, sourceAccountId: v.sourceAccountId, targetAccountId: v.targetAccountId, amount: '', memo: '' });
      },
      error: (e: unknown) => {
        this.busy.set(false);
        const problem = isApiProblem(e) ? e : { status: -1, code: 'UNEXPECTED', message: 'Unexpected error', violations: [], details: {} };
        if (problem.status === 422 && problem.code === 'TRANSACTION_REJECTED') {
          this.keys.reset(); // definitive outcome: a corrected request is a new logical request
          this.outcome.set({ kind: 'rejected', problem });
        } else {
          // network/5xx/409: outcome unknown or retryable - keep the key so a retry is idempotent
          this.outcome.set({ kind: 'error', problem });
        }
      },
    });
  }
}
