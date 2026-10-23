import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Attempt, AuditRow, Transaction, isApiProblem } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';
import { StatusChipComponent } from '../../shared/status-chip.component';

const CANCELLABLE = ['RECEIVED', 'VALIDATED', 'PENDING_REVIEW'];

@Component({
  selector: 'app-transaction-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MoneyPipe, ReactiveFormsModule, RouterLink,
    StateViewComponent, StatusChipComponent],
  template: `
    <section class="page">
      <p><a routerLink="/transactions">&larr; All transactions</a></p>
      <app-state-view [state]="viewState()" [message]="error()" (retry)="load()">
        @if (tx(); as t) {
          <div class="head">
            <h1><span class="mono">{{ t.reference }}</span> <app-status-chip [status]="t.status" /></h1>
            <div class="row-actions">
              @if (canCancel()) { <button mat-stroked-button type="button" [disabled]="acting()" (click)="cancel()">Cancel transaction</button> }
              @if (canReview()) {
                <button mat-flat-button type="button" [disabled]="acting()" (click)="approve()">Approve</button>
                <button mat-stroked-button type="button" (click)="rejecting.set(!rejecting())" [attr.aria-expanded]="rejecting()">Reject…</button>
              }
              @if (t.status === 'RECONCILIATION_REQUIRED' && auth.isStaff()) {
                <a mat-stroked-button routerLink="/investigations" [queryParams]="{ tab: 'reconciliation' }">Open reconciliation</a>
              }
            </div>
          </div>

          @if (message()) { <p class="notice" [class.err]="isError()" [attr.role]="isError() ? 'alert' : 'status'">{{ message() }}</p> }
          @if (t.status === 'PENDING_REVIEW' && auth.isOperator() && !canReview()) {
            <p class="notice">You submitted this transaction, so a different operator must review it (maker-checker).</p>
          }
          @if (rejecting()) {
            <form class="card rejectform" [formGroup]="rejectForm" (ngSubmit)="reject()">
              <mat-form-field appearance="outline" class="grow"><mat-label>Reason for rejection</mat-label>
                <input matInput formControlName="reason" maxlength="255" required />
                @if (rejectForm.controls.reason.touched && rejectForm.controls.reason.invalid) { <mat-error>A reason is required</mat-error> }
              </mat-form-field>
              <button mat-flat-button type="submit" [disabled]="acting()">Confirm rejection</button>
            </form>
          }

          <div class="grid cols-2">
            <section class="card" aria-labelledby="d-details">
              <h2 id="d-details">Details</h2>
              <dl class="facts">
                <dt>Type</dt><dd>{{ t.type }}</dd>
                <dt>Amount</dt><dd><strong>{{ t.amount | money: t.currency }}</strong></dd>
                @if (t.sourceAccountId) { <dt>From</dt><dd><a [routerLink]="['/accounts', t.sourceAccountId]" class="mono">{{ short(t.sourceAccountId) }}</a></dd> }
                @if (t.targetAccountId) { <dt>To</dt><dd><a [routerLink]="['/accounts', t.targetAccountId]" class="mono">{{ short(t.targetAccountId) }}</a></dd> }
                @if (t.memo) { <dt>Memo</dt><dd>{{ t.memo }}</dd> }
                <dt>Submitted by</dt><dd>{{ t.submittedBy }}</dd>
                @if (t.reviewedBy) { <dt>Reviewed by</dt><dd>{{ t.reviewedBy }}</dd> }
                <dt>Created</dt><dd>{{ t.createdAt | date: 'yyyy-MM-dd HH:mm:ss' }}</dd>
                @if (t.completedAt) { <dt>Finished</dt><dd>{{ t.completedAt | date: 'yyyy-MM-dd HH:mm:ss' }}</dd> }
              </dl>
              @if (t.failureCode) {
                <div class="failure" role="note">
                  <strong class="mono">{{ t.failureCode }}</strong>
                  @if (t.failureDetail) { <span>{{ t.failureDetail }}</span> }
                </div>
              }
            </section>

            @if (auth.isStaff()) {
              <section class="card" aria-labelledby="d-attempts">
                <h2 id="d-attempts">Processing attempts</h2>
                @if (attempts().length === 0) { <p class="muted">No processing attempts recorded.</p> } @else {
                  <table class="plain"><caption class="sr-only">Processing attempts</caption>
                    <thead><tr><th scope="col">#</th><th scope="col">Stage</th><th scope="col">Outcome</th><th scope="col">Detail</th></tr></thead>
                    <tbody>@for (a of attempts(); track a.attemptNo) {
                      <tr><td>{{ a.attemptNo }}</td><td>{{ a.stage }}</td><td><app-status-chip [status]="a.outcome" /></td><td class="muted">{{ a.detail }}</td></tr>
                    }</tbody></table>
                }
              </section>
            }
          </div>

          @if (auth.isStaff()) {
            <section class="card timeline" aria-labelledby="d-audit">
              <h2 id="d-audit">Audit trail</h2>
              @if (audit().length === 0) { <p class="muted">No audit events.</p> } @else {
                <ol>@for (e of audit(); track e.id) {
                  <li><time [attr.datetime]="e.occurredAt">{{ e.occurredAt | date: 'HH:mm:ss.SSS' }}</time>
                    <span class="mono">{{ e.action }}</span> <span class="muted">by {{ e.actor }}</span>
                    @if (e.details) { <span class="muted">— {{ e.details }}</span> }</li>
                }</ol>
              }
            </section>
          }
        }
      </app-state-view>
    </section>
  `,
  styles: `
    .head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
    h1 { display: flex; gap: 12px; align-items: center; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    dl.facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; }
    dt { color: var(--muted); } dd { margin: 0; }
    .failure { margin-top: 12px; padding: 8px 10px; border-radius: 6px; background: #fdf5f4; border: 1px solid #f1b3ae; display: flex; flex-direction: column; gap: 2px; }
    .notice { padding: 8px 12px; border-radius: 6px; background: #e8eefc; border: 1px solid #b6c7f2; }
    .notice.err { background: #fdeceb; border-color: #f1b3ae; color: var(--bad); }
    .rejectform { flex-direction: row; gap: 12px; align-items: baseline; margin: 10px 0; display: flex; }
    .grow { flex: 1; }
    table.plain { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.plain th, table.plain td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
    .timeline { margin-top: 14px; } .timeline ol { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; }
  `,
})
export class TransactionDetailComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly tx = signal<Transaction | null>(null);
  protected readonly attempts = signal<Attempt[]>([]);
  protected readonly audit = signal<AuditRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly acting = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly message = signal('');
  protected readonly isError = signal(false);
  protected readonly rejectForm = this.fb.nonNullable.group({ reason: ['', [Validators.required, Validators.maxLength(255)]] });

  protected readonly viewState = computed<ViewState>(() => (this.tx() ? 'ready' : this.loading() ? 'loading' : 'error'));
  protected readonly canCancel = computed(() => {
    const t = this.tx();
    return !!t && CANCELLABLE.includes(t.status) && (this.auth.isOperator() || (this.auth.isCustomer() && this.auth.user()?.username === t.submittedBy));
  });
  protected readonly canReview = computed(() => {
    const t = this.tx();
    return !!t && t.status === 'PENDING_REVIEW' && this.auth.isOperator() && this.auth.user()?.username !== t.submittedBy;
  });

  constructor() {
    effect(() => {
      this.id();
      this.load();
    });
  }

  protected short(id: string): string {
    return id.slice(0, 8) + '…';
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const staff = this.auth.isStaff();
    forkJoin({
      tx: this.api.transaction(this.id()),
      attempts: staff ? this.api.attempts(this.id()).pipe(catchError(() => of([] as Attempt[]))) : of([] as Attempt[]),
      audit: staff ? this.api.transactionAudit(this.id()).pipe(catchError(() => of([] as AuditRow[]))) : of([] as AuditRow[]),
    }).subscribe({
      next: (r) => {
        this.tx.set(r.tx);
        this.attempts.set(r.attempts);
        this.audit.set(r.audit);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.tx.set(null);
        this.error.set(isApiProblem(e) && e.status === 404 ? 'This transaction does not exist or you cannot access it.' : isApiProblem(e) ? e.message : 'The transaction could not be loaded.');
      },
    });
  }

  private run(call: () => ReturnType<ApiService['cancel']>, done: string): void {
    this.acting.set(true);
    this.message.set('');
    call().subscribe({
      next: (t) => {
        this.acting.set(false);
        this.rejecting.set(false);
        this.tx.set(t);
        this.isError.set(false);
        this.message.set(done);
        this.load();
      },
      error: (e: unknown) => {
        this.acting.set(false);
        this.isError.set(true);
        this.message.set(isApiProblem(e) ? `${e.message} (${e.code})` : 'The action failed.');
      },
    });
  }

  protected cancel(): void {
    this.run(() => this.api.cancel(this.id()), 'Transaction cancelled.');
  }

  protected approve(): void {
    this.run(() => this.api.approve(this.id()), 'Approved - the transaction will now be processed.');
  }

  protected reject(): void {
    this.rejectForm.markAllAsTouched();
    if (this.rejectForm.valid) {
      this.run(() => this.api.reject(this.id(), this.rejectForm.getRawValue().reason), 'Transaction rejected.');
    }
  }
}
