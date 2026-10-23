import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabChangeEvent, MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Reconciliation, Transaction, TransactionStatus, isApiProblem } from '../../core/models';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';
import { StatusChipComponent } from '../../shared/status-chip.component';
import { TransactionTableComponent } from '../../shared/transaction-table.component';

type Tab = 'review' | 'failed' | 'reconciliation';
const TABS: Tab[] = ['review', 'failed', 'reconciliation'];
const STATUS_FOR: Record<'review' | 'failed', TransactionStatus[]> = { review: ['PENDING_REVIEW'], failed: ['FAILED', 'REJECTED'] };

/** Work queues for staff: pending review, failed/rejected, and reconciliation-required (with operator resolution). */
@Component({
  selector: 'app-investigations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, ReactiveFormsModule,
    RouterLink, StateViewComponent, StatusChipComponent, TransactionTableComponent],
  template: `
    <section class="page">
      <h1>Investigations</h1>
      <p class="subtitle">Transactions that need a human: approvals, failures, and uncertain external outcomes.</p>

      <mat-tab-group [selectedIndex]="tabIndex()" (selectedTabChange)="onTab($event)" animationDuration="0ms" mat-stretch-tabs="false">
        <mat-tab label="Pending review"></mat-tab>
        <mat-tab label="Failed / rejected"></mat-tab>
        <mat-tab label="Reconciliation"></mat-tab>
      </mat-tab-group>

      <div class="panel">
        @if (activeTab() !== 'reconciliation') {
          <app-state-view [state]="txState()" [message]="error()" (retry)="load()"
                          [emptyText]="activeTab() === 'review' ? 'Nothing is waiting for approval.' : 'No failed or rejected transactions.'">
            <app-transaction-table [rows]="txRows()" [showSubmitter]="true" caption="Investigation queue" />
          </app-state-view>
        } @else {
          <app-state-view [state]="reconState()" [message]="error()" (retry)="load()" emptyText="No open reconciliation records - all external outcomes are known.">
            @if (message()) { <p class="notice" [class.err]="isError()" [attr.role]="isError() ? 'alert' : 'status'">{{ message() }}</p> }
            <ul class="recon">
              @for (r of recon(); track r.id) {
                <li class="card">
                  <div class="top">
                    <a [routerLink]="['/transactions', r.transactionId]" class="mono">{{ r.transactionId.slice(0, 8) }}…</a>
                    <app-status-chip [status]="r.status" /> <span class="mono">{{ r.reasonCode }}</span>
                    <span class="muted">opened {{ r.openedAt | date: 'MM-dd HH:mm:ss' }}</span>
                  </div>
                  @if (r.detail) { <p class="muted">{{ r.detail }}</p> }
                  @if (auth.isOperator() && r.status === 'OPEN') {
                    <form [formGroup]="noteForm" class="resolve">
                      <mat-form-field appearance="outline"><mat-label>Resolution note</mat-label>
                        <input matInput formControlName="note" maxlength="500" [attr.aria-label]="'Resolution note for ' + r.transactionId" /></mat-form-field>
                      <button mat-stroked-button type="button" [disabled]="acting()" (click)="resolve(r, 'CONFIRMED_EXECUTED')">The network executed it</button>
                      <button mat-stroked-button type="button" [disabled]="acting()" (click)="resolve(r, 'CONFIRMED_NOT_EXECUTED')">It was NOT executed (refund)</button>
                    </form>
                  }
                </li>
              }
            </ul>
          </app-state-view>
        }
      </div>
    </section>
  `,
  styles: `
    .panel { margin-top: 14px; }
    .recon { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    .top { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .resolve { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
    .notice { padding: 8px 12px; border-radius: 6px; background: #e3f4f1; border: 1px solid #9fd6cf; }
    .notice.err { background: #fdeceb; border-color: #f1b3ae; color: var(--bad); }
  `,
})
export class InvestigationsComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthService);

  /** Optional ?tab= query parameter (dashboard links). */
  readonly tab = input<string>('');

  protected readonly activeTab = signal<Tab>('review');
  protected readonly tabIndex = computed(() => TABS.indexOf(this.activeTab()));
  protected readonly txRows = signal<Transaction[]>([]);
  protected readonly recon = signal<Reconciliation[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly acting = signal(false);
  protected readonly message = signal('');
  protected readonly isError = signal(false);
  protected readonly noteForm = this.fb.nonNullable.group({ note: '' });

  protected readonly txState = computed<ViewState>(() => (this.loading() ? 'loading' : this.error() ? 'error' : this.txRows().length === 0 ? 'empty' : 'ready'));
  protected readonly reconState = computed<ViewState>(() => (this.loading() ? 'loading' : this.error() ? 'error' : this.recon().length === 0 && !this.message() ? 'empty' : 'ready'));

  constructor() {
    queueMicrotask(() => {
      const t = this.tab() as Tab;
      if (TABS.includes(t)) {
        this.activeTab.set(t);
      }
      this.load();
    });
  }

  protected onTab(e: MatTabChangeEvent): void {
    this.activeTab.set(TABS[e.index] ?? 'review');
    this.message.set('');
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const onError = (e: unknown) => {
      this.loading.set(false);
      this.error.set(isApiProblem(e) ? e.message : 'The queue could not be loaded.');
    };
    if (this.activeTab() === 'reconciliation') {
      this.api.reconciliations({ status: 'OPEN', size: 50 }).subscribe({
        next: (r) => {
          this.recon.set(r.items);
          this.loading.set(false);
        },
        error: onError,
      });
    } else {
      this.api.transactions({ status: STATUS_FOR[this.activeTab() as 'review' | 'failed'], size: 50, sort: 'createdAt,desc' }).subscribe({
        next: (r) => {
          this.txRows.set(r.items);
          this.loading.set(false);
        },
        error: onError,
      });
    }
  }

  protected resolve(r: Reconciliation, resolution: 'CONFIRMED_EXECUTED' | 'CONFIRMED_NOT_EXECUTED'): void {
    this.acting.set(true);
    this.message.set('');
    this.api.resolveReconciliation(r.id, resolution, this.noteForm.getRawValue().note).subscribe({
      next: () => {
        this.acting.set(false);
        this.isError.set(false);
        this.message.set(resolution === 'CONFIRMED_EXECUTED' ? 'Marked as executed - transaction completed.' : 'Marked as not executed - funds returned to the customer.');
        this.noteForm.reset();
        this.load();
      },
      error: (e: unknown) => {
        this.acting.set(false);
        this.isError.set(true);
        this.message.set(isApiProblem(e) ? `${e.message} (${e.code})` : 'Resolution failed.');
      },
    });
  }
}
