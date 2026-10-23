import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { Account, AccountStatus, AccountType, PageResponse, isApiProblem } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';
import { StatusChipComponent } from '../../shared/status-chip.component';

const STATUSES: AccountStatus[] = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'CLOSED'];
const TYPES: AccountType[] = ['BROKERAGE', 'RETIREMENT', 'MONEY_MARKET'];

/** Paginated, filterable, sortable account search (server-side paging; customers only ever receive their own). */
@Component({
  selector: 'app-accounts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MatSelectModule, MatSortModule,
    MatTableModule, MoneyPipe, ReactiveFormsModule, RouterLink, StateViewComponent, StatusChipComponent],
  template: `
    <section class="page">
      <h1>Accounts</h1>
      <p class="subtitle">Search by account number prefix, status or type.</p>

      <form class="filters" [formGroup]="filters" (ngSubmit)="search()" role="search" aria-label="Account filters">
        <mat-form-field appearance="outline"><mat-label>Account number starts with</mat-label>
          <input matInput formControlName="q" maxlength="20" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Status</mat-label>
          <mat-select formControlName="status"><mat-option value="">Any</mat-option>
            @for (s of statuses; track s) { <mat-option [value]="s">{{ s }}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Type</mat-label>
          <mat-select formControlName="type"><mat-option value="">Any</mat-option>
            @for (t of types; track t) { <mat-option [value]="t">{{ t }}</mat-option> }</mat-select></mat-form-field>
        <button mat-flat-button type="submit">Search</button>
        <button mat-button type="button" (click)="reset()">Clear</button>
      </form>

      <app-state-view [state]="viewState()" [message]="error()" (retry)="load()" emptyText="No accounts match these filters.">
        <div class="table-wrap">
          <table mat-table [dataSource]="rows()" matSort (matSortChange)="sort($event)" aria-label="Accounts">
            <ng-container matColumnDef="accountNumber">
              <th mat-header-cell *matHeaderCellDef mat-sort-header>Account</th>
              <td mat-cell *matCellDef="let a"><a class="mono" [routerLink]="['/accounts', a.id]">{{ a.accountNumber }}</a></td>
            </ng-container>
            <ng-container matColumnDef="accountType">
              <th mat-header-cell *matHeaderCellDef mat-sort-header>Type</th>
              <td mat-cell *matCellDef="let a">{{ a.accountType }}</td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef mat-sort-header>Status</th>
              <td mat-cell *matCellDef="let a"><app-status-chip [status]="a.status" /></td>
            </ng-container>
            <ng-container matColumnDef="balance">
              <th mat-header-cell *matHeaderCellDef mat-sort-header class="amount">Balance</th>
              <td mat-cell *matCellDef="let a" class="amount">{{ a.balance | money: a.currency }}</td>
            </ng-container>
            <ng-container matColumnDef="available">
              <th mat-header-cell *matHeaderCellDef class="amount">Available</th>
              <td mat-cell *matCellDef="let a" class="amount">{{ a.availableBalance | money: a.currency }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
        <mat-paginator [length]="total()" [pageSize]="size()" [pageIndex]="page()" [pageSizeOptions]="[10, 20, 50]"
                       (page)="paged($event)" aria-label="Account pages"></mat-paginator>
      </app-state-view>
    </section>
  `,
})
export class AccountsComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  /** Optional ?customerId= query parameter (bound by the router) used by the customer directory link. */
  readonly customerId = input<string>();

  protected readonly statuses = STATUSES;
  protected readonly types = TYPES;
  protected readonly columns = ['accountNumber', 'accountType', 'status', 'balance', 'available'];
  protected readonly filters = this.fb.nonNullable.group({ q: '', status: '' as AccountStatus | '', type: '' as AccountType | '' });

  protected readonly rows = signal<Account[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly size = signal(20);
  protected readonly sortExpr = signal('openedAt,desc');
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly viewState = computed<ViewState>(() =>
    this.loading() ? 'loading' : this.error() ? 'error' : this.rows().length === 0 ? 'empty' : 'ready',
  );

  constructor() {
    this.load();
  }

  protected search(): void {
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
    this.sortExpr.set(s.direction ? `${s.active},${s.direction}` : 'openedAt,desc');
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const f = this.filters.getRawValue();
    this.api.accounts({ ...f, customerId: this.customerId(), page: this.page(), size: this.size(), sort: this.sortExpr() }).subscribe({
      next: (r: PageResponse<Account>) => {
        this.rows.set(r.items);
        this.total.set(r.totalElements);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(isApiProblem(e) ? e.message : 'Accounts could not be loaded.');
      },
    });
  }
}
