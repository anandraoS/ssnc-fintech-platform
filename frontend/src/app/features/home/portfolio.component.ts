import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { Account, Transaction, isApiProblem } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';
import { StatusChipComponent } from '../../shared/status-chip.component';
import { TransactionTableComponent } from '../../shared/transaction-table.component';

/** Customer landing page: own accounts with balances and the most recent activity. */
@Component({
  selector: 'app-portfolio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MoneyPipe, RouterLink, StateViewComponent, StatusChipComponent, TransactionTableComponent],
  template: `
    <section class="page">
      <div class="head">
        <div>
          <h1>My accounts</h1>
          <p class="subtitle">Balances and recent activity for your investment accounts.</p>
        </div>
        <a mat-flat-button routerLink="/transactions/new">New transaction</a>
      </div>

      <app-state-view [state]="viewState()" [message]="error()" (retry)="load()" emptyText="You do not have any accounts yet. Contact support to open one.">
        <div class="grid cols-4">
          @for (a of accounts(); track a.id) {
            <a class="card acct" [routerLink]="['/accounts', a.id]" [attr.aria-label]="'Account ' + a.accountNumber">
              <span class="mono">{{ a.accountNumber }}</span>
              <span class="muted">{{ a.accountType }} · {{ a.currency }}</span>
              <strong>{{ a.balance | money: a.currency }}</strong>
              <span class="muted">Available {{ a.availableBalance | money: a.currency }}</span>
              <app-status-chip [status]="a.status" />
            </a>
          }
        </div>

        <h2>Recent activity</h2>
        @if (recent().length === 0) {
          <p class="muted">No transactions yet.</p>
        } @else {
          <app-transaction-table [rows]="recent()" caption="Recent transactions" />
          <p class="muted">Last updated {{ loadedAt() | date: 'HH:mm:ss' }}. <a routerLink="/transactions">All transactions</a></p>
        }
      </app-state-view>
    </section>
  `,
  styles: `
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .acct { text-decoration: none; color: inherit; display: flex; flex-direction: column; gap: 4px; }
    .acct:hover { border-color: #17324d; }
    .acct strong { font-size: 24px; font-weight: 500; }
    h2 { font-size: 16px; margin: 24px 0 8px; }
  `,
})
export class PortfolioComponent {
  private readonly api = inject(ApiService);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly recent = signal<Transaction[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly loadedAt = signal(new Date());
  protected readonly viewState = computed<ViewState>(() =>
    this.loading() ? 'loading' : this.error() ? 'error' : this.accounts().length === 0 ? 'empty' : 'ready',
  );

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      accounts: this.api.accounts({ size: 50, sort: 'openedAt,asc' }),
      recent: this.api.transactions({ size: 8, sort: 'createdAt,desc' }),
    }).subscribe({
      next: (r) => {
        this.accounts.set(r.accounts.items);
        this.recent.set(r.recent.items);
        this.loadedAt.set(new Date());
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(isApiProblem(e) ? e.message : 'Your accounts could not be loaded.');
      },
    });
  }
}
