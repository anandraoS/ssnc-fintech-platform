import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Account, Balance, Transaction, isApiProblem } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';
import { StatusChipComponent } from '../../shared/status-chip.component';
import { TransactionTableComponent } from '../../shared/transaction-table.component';

@Component({
  selector: 'app-account-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MoneyPipe,
    ReactiveFormsModule, RouterLink, StateViewComponent, StatusChipComponent, TransactionTableComponent],
  template: `
    <section class="page">
      <p><a routerLink="/accounts">&larr; All accounts</a></p>
      <app-state-view [state]="viewState()" [message]="error()" (retry)="load()">
        @if (account(); as a) {
          <div class="head">
            <div>
              <h1><span class="mono">{{ a.accountNumber }}</span> <app-status-chip [status]="a.status" /></h1>
              <p class="subtitle">{{ a.accountType }} · {{ a.currency }} · opened {{ a.openedAt | date: 'yyyy-MM-dd' }}
                @if (a.statusReason) { · <em>{{ a.statusReason }}</em> }</p>
            </div>
            <div class="row-actions">
              @if (a.status === 'ACTIVE' && canTransact()) {
                <a mat-flat-button [routerLink]="['/transactions/new']" [queryParams]="{ account: a.id }">New transaction</a>
              }
              @if (auth.isOperator()) {
                @if (a.status === 'PENDING_ACTIVATION' || a.status === 'SUSPENDED') {
                  <button mat-stroked-button type="button" [disabled]="acting()" (click)="act('activate')">
                    {{ a.status === 'SUSPENDED' ? 'Reactivate' : 'Activate' }}</button>
                }
                @if (a.status === 'ACTIVE') {
                  <button mat-stroked-button type="button" (click)="suspending.set(!suspending())" [attr.aria-expanded]="suspending()">Suspend…</button>
                }
                @if (auth.isAdmin() && a.status !== 'CLOSED') {
                  <button mat-stroked-button type="button" [disabled]="acting()" (click)="act('close')">Close</button>
                }
              }
            </div>
          </div>

          @if (actionMessage()) {
            <p class="notice" [class.err]="actionIsError()" [attr.role]="actionIsError() ? 'alert' : 'status'">{{ actionMessage() }}</p>
          }

          @if (suspending()) {
            <form class="card suspend" [formGroup]="suspendForm" (ngSubmit)="suspend()">
              <mat-form-field appearance="outline" class="grow"><mat-label>Reason for suspension</mat-label>
                <input matInput formControlName="reason" maxlength="255" required />
                @if (suspendForm.controls.reason.touched && suspendForm.controls.reason.invalid) { <mat-error>A reason is required</mat-error> }
              </mat-form-field>
              <button mat-flat-button type="submit" [disabled]="acting()">Confirm suspension</button>
            </form>
          }

          <div class="grid cols-4">
            <div class="card"><span class="label">Ledger balance</span><strong>{{ (balance()?.ledgerBalance ?? a.balance) | money: a.currency }}</strong></div>
            <div class="card"><span class="label">Available</span><strong>{{ (balance()?.availableBalance ?? a.availableBalance) | money: a.currency }}</strong>
              <span class="muted">after minimum balance {{ a.minimumBalance | money: a.currency }}</span></div>
            <div class="card"><span class="label">Daily withdrawal limit</span><strong>{{ a.dailyWithdrawalLimit | money: a.currency }}</strong></div>
          </div>

          <h2>Transaction history</h2>
          <app-state-view [state]="historyState()" [message]="historyError()" (retry)="loadHistory()" emptyText="No transactions on this account yet.">
            <app-transaction-table [rows]="history()" caption="Account transactions" />
            <mat-paginator [length]="historyTotal()" [pageSize]="historySize()" [pageIndex]="historyPage()"
                           [pageSizeOptions]="[10, 20, 50]" (page)="historyPaged($event)" aria-label="History pages"></mat-paginator>
          </app-state-view>
        }
      </app-state-view>
    </section>
  `,
  styles: `
    .head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
    h1 { display: flex; gap: 12px; align-items: center; }
    .card { display: flex; flex-direction: column; gap: 4px; }
    .card strong { font-size: 24px; font-weight: 500; }
    .label { color: var(--muted); font-size: 13px; }
    h2 { font-size: 16px; margin: 24px 0 8px; }
    .notice { padding: 8px 12px; border-radius: 6px; background: #e3f4f1; border: 1px solid #9fd6cf; }
    .notice.err { background: #fdeceb; border-color: #f1b3ae; color: var(--bad); }
    .suspend { flex-direction: row; gap: 12px; align-items: baseline; margin: 10px 0; }
    .grow { flex: 1; }
  `,
})
export class AccountDetailComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthService);

  /** Bound from the route parameter (withComponentInputBinding). */
  readonly id = input.required<string>();

  protected readonly account = signal<Account | null>(null);
  protected readonly balance = signal<Balance | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly viewState = computed<ViewState>(() => (this.account() ? 'ready' : this.loading() ? 'loading' : 'error'));

  protected readonly history = signal<Transaction[]>([]);
  protected readonly historyTotal = signal(0);
  protected readonly historyPage = signal(0);
  protected readonly historySize = signal(10);
  protected readonly historyLoading = signal(true);
  protected readonly historyError = signal('');
  protected readonly historyState = computed<ViewState>(() =>
    this.historyLoading() ? 'loading' : this.historyError() ? 'error' : this.history().length === 0 ? 'empty' : 'ready',
  );

  protected readonly suspending = signal(false);
  protected readonly acting = signal(false);
  protected readonly actionMessage = signal('');
  protected readonly actionIsError = signal(false);
  protected readonly suspendForm = this.fb.nonNullable.group({ reason: ['', [Validators.required, Validators.maxLength(255)]] });
  protected readonly canTransact = computed(() => this.auth.hasAny('CUSTOMER', 'OPERATIONS_ANALYST', 'ADMIN'));

  constructor() {
    effect(() => {
      this.id(); // reload whenever the route parameter changes
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({ account: this.api.account(this.id()), balance: this.api.balance(this.id()) }).subscribe({
      next: (r) => {
        this.account.set(r.account);
        this.balance.set(r.balance);
        this.loading.set(false);
        this.loadHistory();
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.account.set(null);
        this.error.set(isApiProblem(e) && e.status === 404 ? 'This account does not exist or you cannot access it.' : isApiProblem(e) ? e.message : 'The account could not be loaded.');
      },
    });
  }

  loadHistory(): void {
    this.historyLoading.set(true);
    this.historyError.set('');
    this.api.accountTransactions(this.id(), { page: this.historyPage(), size: this.historySize(), sort: 'createdAt,desc' }).subscribe({
      next: (r) => {
        this.history.set(r.items);
        this.historyTotal.set(r.totalElements);
        this.historyLoading.set(false);
      },
      error: (e: unknown) => {
        this.historyLoading.set(false);
        this.historyError.set(isApiProblem(e) ? e.message : 'History could not be loaded.');
      },
    });
  }

  protected historyPaged(e: PageEvent): void {
    this.historyPage.set(e.pageIndex);
    this.historySize.set(e.pageSize);
    this.loadHistory();
  }

  protected suspend(): void {
    this.suspendForm.markAllAsTouched();
    if (this.suspendForm.valid) {
      this.act('suspend', this.suspendForm.getRawValue().reason);
    }
  }

  protected act(action: 'activate' | 'suspend' | 'close', reason?: string): void {
    this.acting.set(true);
    this.actionMessage.set('');
    this.api.accountAction(this.id(), action, reason).subscribe({
      next: (a) => {
        this.acting.set(false);
        this.suspending.set(false);
        this.suspendForm.reset();
        this.account.set(a);
        this.actionIsError.set(false);
        this.actionMessage.set(`Account is now ${a.status.replace(/_/g, ' ').toLowerCase()}.`);
      },
      error: (e: unknown) => {
        this.acting.set(false);
        this.actionIsError.set(true);
        this.actionMessage.set(isApiProblem(e) ? `${e.message}${e.code ? ' (' + e.code + ')' : ''}` : 'The action failed.');
      },
    });
  }
}
