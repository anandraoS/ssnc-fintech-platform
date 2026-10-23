import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Customer, isApiProblem } from '../../core/models';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';
import { StatusChipComponent } from '../../shared/status-chip.component';

/** Customer directory (staff). Support agents see masked contact details; operators can create customers. */
@Component({
  selector: 'app-customers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MatTableModule,
    ReactiveFormsModule, RouterLink, StateViewComponent, StatusChipComponent],
  template: `
    <section class="page">
      <h1>Customers</h1>
      <p class="subtitle">Synthetic customer profiles. @if (!auth.isOperator()) { Contact details are masked for your role. }</p>

      <form class="filters" [formGroup]="search" (ngSubmit)="doSearch()" role="search" aria-label="Customer search">
        <mat-form-field appearance="outline"><mat-label>Name, e-mail or reference</mat-label>
          <input matInput formControlName="q" maxlength="100" /></mat-form-field>
        <button mat-flat-button type="submit">Search</button>
      </form>

      @if (auth.isOperator()) {
        <details class="card create" [open]="createOpen()">
          <summary>Create customer</summary>
          <form [formGroup]="create" (ngSubmit)="submitCreate()" class="filters" novalidate>
            <mat-form-field appearance="outline"><mat-label>Legal name</mat-label>
              <input matInput formControlName="legalName" required maxlength="200" />
              @if (create.controls.legalName.touched && create.controls.legalName.invalid) { <mat-error>Name is required</mat-error> }</mat-form-field>
            <mat-form-field appearance="outline"><mat-label>E-mail</mat-label>
              <input matInput type="email" formControlName="email" required maxlength="254" />
              @if (create.controls.email.touched && create.controls.email.invalid) { <mat-error>A valid e-mail is required</mat-error> }</mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Phone (optional)</mat-label>
              <input matInput formControlName="phone" maxlength="32" />
              @if (create.controls.phone.invalid) { <mat-error>Digits, spaces and + ( ) - only</mat-error> }</mat-form-field>
            <button mat-flat-button type="submit" [disabled]="creating()">Create</button>
          </form>
          @if (createMessage()) { <p [attr.role]="createFailed() ? 'alert' : 'status'" [class.err]="createFailed()">{{ createMessage() }}</p> }
        </details>
      }

      <app-state-view [state]="viewState()" [message]="error()" (retry)="load()" emptyText="No customers match your search.">
        <div class="table-wrap">
          <table mat-table [dataSource]="rows()" aria-label="Customers">
            <ng-container matColumnDef="customerRef"><th mat-header-cell *matHeaderCellDef>Reference</th>
              <td mat-cell *matCellDef="let c"><span class="mono">{{ c.customerRef }}</span></td></ng-container>
            <ng-container matColumnDef="legalName"><th mat-header-cell *matHeaderCellDef>Name</th>
              <td mat-cell *matCellDef="let c">{{ c.legalName }}</td></ng-container>
            <ng-container matColumnDef="email"><th mat-header-cell *matHeaderCellDef>E-mail</th>
              <td mat-cell *matCellDef="let c">{{ c.email }}</td></ng-container>
            <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let c"><app-status-chip [status]="c.status" /></td></ng-container>
            <ng-container matColumnDef="createdAt"><th mat-header-cell *matHeaderCellDef>Created</th>
              <td mat-cell *matCellDef="let c">{{ c.createdAt | date: 'yyyy-MM-dd' }}</td></ng-container>
            <ng-container matColumnDef="accounts"><th mat-header-cell *matHeaderCellDef>Accounts</th>
              <td mat-cell *matCellDef="let c"><a [routerLink]="['/accounts']" [queryParams]="{ customerId: c.id }">view</a></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
        <mat-paginator [length]="total()" [pageSize]="size()" [pageIndex]="page()" [pageSizeOptions]="[10, 20, 50]"
                       (page)="paged($event)" aria-label="Customer pages"></mat-paginator>
      </app-state-view>
    </section>
  `,
  styles: `
    .create { margin-bottom: 14px; }
    .create summary { cursor: pointer; font-weight: 500; }
    .err { color: var(--bad); }
  `,
})
export class CustomersComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthService);

  protected readonly columns = ['customerRef', 'legalName', 'email', 'status', 'createdAt'];
  protected readonly search = this.fb.nonNullable.group({ q: '' });
  protected readonly create = this.fb.nonNullable.group({
    legalName: ['', [Validators.required, Validators.maxLength(200)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    phone: ['', [Validators.maxLength(32), Validators.pattern(/^[+0-9() -]*$/)]],
  });

  protected readonly rows = signal<Customer[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly size = signal(20);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly creating = signal(false);
  protected readonly createOpen = signal(false);
  protected readonly createMessage = signal('');
  protected readonly createFailed = signal(false);
  protected readonly viewState = computed<ViewState>(() =>
    this.loading() ? 'loading' : this.error() ? 'error' : this.rows().length === 0 ? 'empty' : 'ready',
  );

  constructor() {
    this.load();
  }

  protected doSearch(): void {
    this.page.set(0);
    this.load();
  }

  protected paged(e: PageEvent): void {
    this.page.set(e.pageIndex);
    this.size.set(e.pageSize);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.customers({ q: this.search.getRawValue().q, page: this.page(), size: this.size() }).subscribe({
      next: (r) => {
        this.rows.set(r.items);
        this.total.set(r.totalElements);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(isApiProblem(e) ? e.message : 'Customers could not be loaded.');
      },
    });
  }

  protected submitCreate(): void {
    this.create.markAllAsTouched();
    if (this.create.invalid || this.creating()) {
      return;
    }
    this.creating.set(true);
    const v = this.create.getRawValue();
    this.api.createCustomer({ legalName: v.legalName, email: v.email, phone: v.phone || undefined }).subscribe({
      next: (c) => {
        this.creating.set(false);
        this.createFailed.set(false);
        this.createMessage.set(`Created ${c.customerRef}.`);
        this.create.reset();
        this.load();
      },
      error: (e: unknown) => {
        this.creating.set(false);
        this.createFailed.set(true);
        this.createMessage.set(isApiProblem(e) ? (e.violations[0]?.message ?? e.message) : 'Customer could not be created.');
      },
    });
  }
}
