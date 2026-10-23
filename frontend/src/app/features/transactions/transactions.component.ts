import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { Sort } from '@angular/material/sort';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ALL_TRANSACTION_STATUSES, Transaction, TransactionStatus, TransactionType, isApiProblem } from '../../core/models';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';
import { TransactionTableComponent } from '../../shared/transaction-table.component';

const AMOUNT = /^\d{1,15}(\.\d{1,4})?$/;

/** Transaction search with status/type/reference/date/amount filters, server-side paging and sorting. */
@Component({
  selector: 'app-transactions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MatSelectModule, ReactiveFormsModule,
    RouterLink, StateViewComponent, TransactionTableComponent],
  template: `
    <section class="page">
      <div class="head">
        <div><h1>Transactions</h1><p class="subtitle">Search and track transaction requests.</p></div>
        <a mat-stroked-button routerLink="/transactions/new">New transaction</a>
      </div>

      <form class="filters" [formGroup]="filters" (ngSubmit)="search()" role="search" aria-label="Transaction filters" novalidate>
        <mat-form-field appearance="outline"><mat-label>Status</mat-label>
          <mat-select formControlName="status" multiple>
            @for (s of statuses; track s) { <mat-option [value]="s">{{ s }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Type</mat-label>
          <mat-select formControlName="type"><mat-option value="">Any</mat-option>
            <mat-option value="DEPOSIT">DEPOSIT</mat-option><mat-option value="WITHDRAWAL">WITHDRAWAL</mat-option>
            <mat-option value="TRANSFER">TRANSFER</mat-option></mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Reference</mat-label>
          <input matInput formControlName="reference" placeholder="TXN-…" maxlength="30" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>From (date)</mat-label>
          <input matInput type="date" formControlName="from" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>To (date)</mat-label>
          <input matInput type="date" formControlName="to" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Min amount</mat-label>
          <input matInput inputmode="decimal" formControlName="minAmount" />
          @if (filters.controls.minAmount.invalid) { <mat-error>Enter a decimal such as 100.50</mat-error> }</mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Max amount</mat-label>
          <input matInput inputmode="decimal" formControlName="maxAmount" />
          @if (filters.controls.maxAmount.invalid) { <mat-error>Enter a decimal such as 100.50</mat-error> }</mat-form-field>
        <button mat-flat-button type="submit">Search</button>
        <button mat-button type="button" (click)="reset()">Clear</button>
      </form>

      <app-state-view [state]="viewState()" [message]="error()" (retry)="load()" emptyText="No transactions match these filters.">
        <app-transaction-table [rows]="rows()" [showSubmitter]="true" (sortChange)="sort($event)" />
        <mat-paginator [length]="total()" [pageSize]="size()" [pageIndex]="page()" [pageSizeOptions]="[10, 20, 50]"
                       (page)="paged($event)" aria-label="Transaction pages"></mat-paginator>
      </app-state-view>
    </section>
  `,
  styles: `.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }`,
})
export class TransactionsComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  /** Optional ?status= query parameter (dashboard links) bound by the router. */
  readonly status = input<string>();

  protected readonly statuses = ALL_TRANSACTION_STATUSES;
  protected readonly filters = this.fb.nonNullable.group({
    status: [[] as TransactionStatus[]],
    type: '' as TransactionType | '',
    reference: '',
    from: '',
    to: '',
    minAmount: ['', (c: { value: string }) => (c.value === '' || AMOUNT.test(c.value) ? null : { amount: true })],
    maxAmount: ['', (c: { value: string }) => (c.value === '' || AMOUNT.test(c.value) ? null : { amount: true })],
  });

  protected readonly rows = signal<Transaction[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly size = signal(20);
  protected readonly sortExpr = signal('createdAt,desc');
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly viewState = computed<ViewState>(() =>
    this.loading() ? 'loading' : this.error() ? 'error' : this.rows().length === 0 ? 'empty' : 'ready',
  );

  constructor() {
    queueMicrotask(() => {
      const initial = this.status();
      if (initial && (ALL_TRANSACTION_STATUSES as string[]).includes(initial)) {
        this.filters.patchValue({ status: [initial as TransactionStatus] });
      }
      this.load();
    });
  }

  protected search(): void {
    if (this.filters.invalid) {
      this.filters.markAllAsTouched();
      return;
    }
    this.page.set(0);
    this.load();
  }

  protected reset(): void {
    this.filters.reset();
    this.search();
  }

  protected paged(e: PageEvent): void {
    this.page.set(e.pageIndex);
    this.size.set(e.pageSize);
    this.load();
  }

  protected sort(s: Sort): void {
    this.sortExpr.set(s.direction ? `${s.active},${s.direction}` : 'createdAt,desc');
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const f = this.filters.getRawValue();
    this.api.transactions({
      status: f.status, type: f.type, reference: f.reference.trim(),
      from: f.from ? `${f.from}T00:00:00Z` : '', to: f.to ? `${f.to}T23:59:59Z` : '',
      minAmount: f.minAmount, maxAmount: f.maxAmount,
      page: this.page(), size: this.size(), sort: this.sortExpr(),
    }).subscribe({
      next: (r) => {
        this.rows.set(r.items);
        this.total.set(r.totalElements);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(isApiProblem(e) ? e.message : 'Transactions could not be loaded.');
      },
    });
  }
}
