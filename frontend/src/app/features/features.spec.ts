import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ACCOUNT, TX, loginAs, page } from '../../testing/helpers';
import { Role } from '../core/models';
import { authInterceptor, correlationInterceptor, errorInterceptor } from '../core/interceptors';
import { AccountsComponent } from './accounts/accounts.component';
import { InvestigationsComponent } from './investigations/investigations.component';
import { ShellComponent } from './shell/shell.component';
import { TransactionDetailComponent } from './transactions/transaction-detail.component';
import { TransactionsComponent } from './transactions/transactions.component';

function configure(roles: Role[], username = 'tester', customerId: string | null = null): HttpTestingController {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(withInterceptors([errorInterceptor, authInterceptor, correlationInterceptor])), provideHttpClientTesting()],
  });
  const ctl = TestBed.inject(HttpTestingController);
  loginAs(roles, username, customerId);
  return ctl;
}

describe('ShellComponent role-aware navigation', () => {
  function links(roles: Role[]): string[] {
    TestBed.resetTestingModule();
    const ctl = configure(roles);
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    ctl.verify();
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a[mat-list-item]')).map((a) => a.textContent?.trim() ?? '');
  }

  it('customers see their own pages only', () => {
    expect(links(['CUSTOMER'])).toEqual(['Overview', 'Accounts', 'Transactions', 'New transaction']);
  });

  it('support agents get look-up pages but cannot start a transaction', () => {
    const items = links(['SUPPORT_AGENT']);
    expect(items).toContain('Customers');
    expect(items).toContain('Investigations');
    expect(items).toContain('Audit trail');
    expect(items).not.toContain('New transaction');
  });

  it('operators and admins see everything', () => {
    expect(links(['OPERATIONS_ANALYST']).length).toBe(7);
    expect(links(['ADMIN']).length).toBe(7);
  });
});

describe('AccountsComponent', () => {
  it('requests the first page with server-side paging and shows rows', () => {
    const ctl = configure(['SUPPORT_AGENT']);
    const fixture = TestBed.createComponent(AccountsComponent);
    fixture.detectChanges();
    const req = ctl.expectOne((r) => r.url === '/api/v1/accounts');
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('size')).toBe('20');
    expect(req.request.params.has('status')).toBeFalse(); // empty filters are not sent
    req.flush(page([ACCOUNT], { totalElements: 1 }));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ACC-1000000001');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('$1,000.00');
    ctl.verify();
  });

  it('shows the empty state when nothing matches', () => {
    const ctl = configure(['SUPPORT_AGENT']);
    const fixture = TestBed.createComponent(AccountsComponent);
    fixture.detectChanges();
    ctl.expectOne((r) => r.url === '/api/v1/accounts').flush(page([]));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No accounts match these filters');
    ctl.verify();
  });
});

describe('TransactionsComponent', () => {
  it('sends the selected filters and blocks malformed amounts', async () => {
    const ctl = configure(['SUPPORT_AGENT']);
    const fixture = TestBed.createComponent(TransactionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    ctl.expectOne((r) => r.url === '/api/v1/transactions').flush(page([TX]));
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { filters: import('@angular/forms').FormGroup; search(): void };
    component.filters.patchValue({ status: ['FAILED'], type: 'WITHDRAWAL', minAmount: '10.50' });
    component.search();
    const req = ctl.expectOne((r) => r.url === '/api/v1/transactions');
    expect(req.request.params.getAll('status')).toEqual(['FAILED']);
    expect(req.request.params.get('type')).toBe('WITHDRAWAL');
    expect(req.request.params.get('minAmount')).toBe('10.50');
    expect(req.request.params.get('page')).toBe('0');
    req.flush(page([]));

    component.filters.patchValue({ minAmount: '1,5' });
    component.search();
    ctl.expectNone((r) => r.url === '/api/v1/transactions'); // invalid input never reaches the server
    ctl.verify();
  });
});

describe('TransactionDetailComponent permissions', () => {
  const pending = { ...TX, status: 'PENDING_REVIEW' as const, submittedBy: 'omar.ops' };

  function open(roles: Role[], username: string, tx: object) {
    const ctl = configure(roles, username);
    const fixture = TestBed.createComponent(TransactionDetailComponent);
    fixture.componentRef.setInput('id', TX.id);
    fixture.detectChanges();
    ctl.expectOne(`/api/v1/transactions/${TX.id}`).flush(tx);
    if (roles.some((r) => r !== 'CUSTOMER')) {
      ctl.expectOne(`/api/v1/transactions/${TX.id}/attempts`).flush([]);
      ctl.expectOne(`/api/v1/transactions/${TX.id}/audit`).flush([]);
    }
    fixture.detectChanges();
    ctl.verify();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('a DIFFERENT operator can approve or reject a pending transaction', () => {
    const text = open(['OPERATIONS_ANALYST'], 'olivia.ops', pending);
    expect(text).toContain('Approve');
    expect(text).toContain('Reject');
  });

  it('the submitting operator is told a second person must review (maker-checker)', () => {
    const text = open(['OPERATIONS_ANALYST'], 'omar.ops', pending);
    expect(text).not.toContain('Approve');
    expect(text).toContain('a different operator must review it');
  });

  it('a customer can cancel their own pending transaction but never approve', () => {
    const text = open(['CUSTOMER'], 'alice.customer', { ...pending, submittedBy: 'alice.customer' });
    expect(text).toContain('Cancel transaction');
    expect(text).not.toContain('Approve');
  });

  it('a completed transaction offers no actions, and failures show their code', () => {
    const text = open(['OPERATIONS_ANALYST'], 'olivia.ops', { ...TX, status: 'FAILED', failureCode: 'CLEARING_DECLINED', failureDetail: 'RISK_DECLINE' });
    expect(text).not.toContain('Cancel transaction');
    expect(text).not.toContain('Approve');
    expect(text).toContain('CLEARING_DECLINED');
  });
});

describe('InvestigationsComponent', () => {
  it('lets an operator resolve a reconciliation record and reloads the queue', async () => {
    const ctl = configure(['OPERATIONS_ANALYST'], 'omar.ops');
    const fixture = TestBed.createComponent(InvestigationsComponent);
    fixture.componentRef.setInput('tab', 'reconciliation');
    fixture.detectChanges();
    await fixture.whenStable();
    const record = { id: 'r1', transactionId: TX.id, status: 'OPEN', reasonCode: 'CLEARING_OUTCOME_UNKNOWN', openedAt: '2026-01-01T10:00:00Z' };
    ctl.expectOne((r) => r.url === '/api/v1/ops/reconciliations').flush(page([record]));
    fixture.detectChanges();
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    const notExecuted = buttons.find((b) => b.textContent?.includes('NOT executed')) as HTMLButtonElement;
    expect(notExecuted).toBeDefined();
    notExecuted.click();
    const resolve = ctl.expectOne('/api/v1/ops/reconciliations/r1/resolve');
    expect(resolve.request.body.resolution).toBe('CONFIRMED_NOT_EXECUTED');
    resolve.flush({ ...record, status: 'RESOLVED' });
    ctl.expectOne((r) => r.url === '/api/v1/ops/reconciliations').flush(page([]));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('funds returned to the customer');
    ctl.verify();
  });

  it('a support agent sees the queue read-only (no resolve buttons)', async () => {
    const ctl = configure(['SUPPORT_AGENT']);
    const fixture = TestBed.createComponent(InvestigationsComponent);
    fixture.componentRef.setInput('tab', 'reconciliation');
    fixture.detectChanges();
    await fixture.whenStable();
    ctl.expectOne((r) => r.url === '/api/v1/ops/reconciliations').flush(page([{ id: 'r1', transactionId: TX.id, status: 'OPEN', reasonCode: 'X', openedAt: '2026-01-01T10:00:00Z' }]));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('NOT executed');
    ctl.verify();
  });
});
