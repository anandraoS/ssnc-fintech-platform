import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { output } from '@angular/core';
import { Transaction } from '../core/models';
import { MoneyPipe } from './money.pipe';
import { StatusChipComponent } from './status-chip.component';

@Component({
  selector: 'app-transaction-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatSortModule, MatTableModule, MoneyPipe, RouterLink, StatusChipComponent],
  template: `
    <div class="table-wrap">
      <table mat-table [dataSource]="rows()" matSort (matSortChange)="sortChange.emit($event)" [attr.aria-label]="caption()">
        <ng-container matColumnDef="reference">
          <th mat-header-cell *matHeaderCellDef mat-sort-header="reference">Reference</th>
          <td mat-cell *matCellDef="let t"><a class="mono" [routerLink]="['/transactions', t.id]">{{ t.reference }}</a></td>
        </ng-container>
        <ng-container matColumnDef="type">
          <th mat-header-cell *matHeaderCellDef>Type</th>
          <td mat-cell *matCellDef="let t">{{ t.type }}</td>
        </ng-container>
        <ng-container matColumnDef="amount">
          <th mat-header-cell *matHeaderCellDef mat-sort-header="amount" class="amount">Amount</th>
          <td mat-cell *matCellDef="let t" class="amount">{{ t.amount | money: t.currency }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef mat-sort-header="status">Status</th>
          <td mat-cell *matCellDef="let t"><app-status-chip [status]="t.status" /></td>
        </ng-container>
        <ng-container matColumnDef="failure">
          <th mat-header-cell *matHeaderCellDef>Reason</th>
          <td mat-cell *matCellDef="let t"><span class="mono">{{ t.failureCode ?? '' }}</span></td>
        </ng-container>
        <ng-container matColumnDef="submittedBy">
          <th mat-header-cell *matHeaderCellDef>Submitted by</th>
          <td mat-cell *matCellDef="let t">{{ t.submittedBy }}</td>
        </ng-container>
        <ng-container matColumnDef="createdAt">
          <th mat-header-cell *matHeaderCellDef mat-sort-header="createdAt">Created</th>
          <td mat-cell *matCellDef="let t">{{ t.createdAt | date: 'yyyy-MM-dd HH:mm:ss' }}</td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns()"></tr>
        <tr mat-row *matRowDef="let row; columns: columns()"></tr>
      </table>
    </div>
  `,
})
export class TransactionTableComponent {
  readonly rows = input.required<Transaction[]>();
  readonly caption = input<string>('Transactions');
  readonly showSubmitter = input<boolean>(false);
  readonly sortChange = output<Sort>();

  protected columns(): string[] {
    const base = ['reference', 'type', 'amount', 'status', 'failure', 'createdAt'];
    return this.showSubmitter() ? [...base.slice(0, 5), 'submittedBy', 'createdAt'] : base;
  }
}
