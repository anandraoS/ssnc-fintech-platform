import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { ApiService } from '../../core/api.service';
import { AuditRow, isApiProblem } from '../../core/models';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';

const ENTITY_TYPES = ['CUSTOMER', 'ACCOUNT', 'TRANSACTION', 'USER', 'SYSTEM'];

/** Append-only audit trail viewer with filters and paging. */
@Component({
  selector: 'app-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MatSelectModule,
    MatTableModule, ReactiveFormsModule, StateViewComponent],
  template: `
    <section class="page">
      <h1>Audit trail</h1>
      <p class="subtitle">Immutable record of account, transaction and access events.</p>

      <form class="filters" [formGroup]="filters" (ngSubmit)="search()" role="search" aria-label="Audit filters">
        <mat-form-field appearance="outline"><mat-label>Action</mat-label>
          <input matInput formControlName="action" placeholder="TRANSACTION_COMPLETED" maxlength="60" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Entity type</mat-label>
          <mat-select formControlName="entityType"><mat-option value="">Any</mat-option>
            @for (t of entityTypes; track t) { <mat-option [value]="t">{{ t }}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Entity id</mat-label>
          <input matInput formControlName="entityId" maxlength="64" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Actor</mat-label>
          <input matInput formControlName="actor" maxlength="100" /></mat-form-field>
        <button mat-flat-button type="submit">Search</button>
        <button mat-button type="button" (click)="reset()">Clear</button>
      </form>

      <app-state-view [state]="viewState()" [message]="error()" (retry)="load()" emptyText="No audit events match these filters.">
        <div class="table-wrap">
          <table mat-table [dataSource]="rows()" aria-label="Audit events">
            <ng-container matColumnDef="occurredAt"><th mat-header-cell *matHeaderCellDef>Time</th>
              <td mat-cell *matCellDef="let e">{{ e.occurredAt | date: 'yyyy-MM-dd HH:mm:ss' }}</td></ng-container>
            <ng-container matColumnDef="actor"><th mat-header-cell *matHeaderCellDef>Actor</th>
              <td mat-cell *matCellDef="let e">{{ e.actor }}</td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>Action</th>
              <td mat-cell *matCellDef="let e"><span class="mono">{{ e.action }}</span></td></ng-container>
            <ng-container matColumnDef="entity"><th mat-header-cell *matHeaderCellDef>Entity</th>
              <td mat-cell *matCellDef="let e">{{ e.entityType }} <span class="mono muted">{{ e.entityId.slice(0, 13) }}</span></td></ng-container>
            <ng-container matColumnDef="details"><th mat-header-cell *matHeaderCellDef>Details</th>
              <td mat-cell *matCellDef="let e" class="muted">{{ e.details }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
        <mat-paginator [length]="total()" [pageSize]="size()" [pageIndex]="page()" [pageSizeOptions]="[20, 50, 100]"
                       (page)="paged($event)" aria-label="Audit pages"></mat-paginator>
      </app-state-view>
    </section>
  `,
})
export class AuditComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly entityTypes = ENTITY_TYPES;
  protected readonly columns = ['occurredAt', 'actor', 'action', 'entity', 'details'];
  protected readonly filters = this.fb.nonNullable.group({ action: '', entityType: '', entityId: '', actor: '' });
  protected readonly rows = signal<AuditRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly size = signal(20);
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

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.auditEvents({ ...this.filters.getRawValue(), page: this.page(), size: this.size(), sort: 'occurredAt,desc' }).subscribe({
      next: (r) => {
        this.rows.set(r.items);
        this.total.set(r.totalElements);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(isApiProblem(e) ? e.message : 'Audit events could not be loaded.');
      },
    });
  }
}
