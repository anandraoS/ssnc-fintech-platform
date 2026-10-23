import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { loginAs, page } from '../../../testing/helpers';
import { authInterceptor, correlationInterceptor, errorInterceptor } from '../../core/interceptors';
import { DashboardComponent } from './dashboard.component';

const SUMMARY = {
  generatedAt: '2026-01-01T10:00:00Z',
  transactionsByStatus: { COMPLETED: 8, FAILED: 2, PENDING_REVIEW: 1, RECONCILIATION_REQUIRED: 1 },
  completedVolumeLast24h: [{ type: 'DEPOSIT', currency: 'USD', count: 3, volume: '1500.00' }],
  completedLast24h: 8, failedLast24h: 2, pendingReview: 1, reconciliationRequired: 1, openReconciliationRecords: 1,
  transactionFailureRateLast24h: 0.2,
  processingLatency: { sampleSize: 8, averageMs: 42.4, p50Ms: 30, p95Ms: 120, p99Ms: 150 },
  http: { totalRequests: 100, serverErrors: 1, errorRate: 0.01 },
  accountsByStatus: { ACTIVE: 9, SUSPENDED: 1 },
  totalBalances: [{ currency: 'USD', total: '143900.00' }],
};
const HEALTH = { status: 'DEGRADED', checkedAt: '2026-01-01T10:00:00Z', components: [
  { name: 'database', status: 'UP', detail: 'round trip 2 ms' }, { name: 'outbox', status: 'DEGRADED', detail: 'dead-lettered=1' }] };
const AUDIT = page([{ id: 1, occurredAt: '2026-01-01T10:00:00Z', actor: 'omar.ops', action: 'TRANSACTION_COMPLETED', entityType: 'TRANSACTION', entityId: 'x' }]);

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let ctl: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([errorInterceptor, authInterceptor, correlationInterceptor])), provideHttpClientTesting()],
    });
    ctl = TestBed.inject(HttpTestingController);
    loginAs(['OPERATIONS_ANALYST'], 'omar.ops');
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy(); // stops the refresh timer
    ctl.verify();
  });

  /** forkJoin cancels its siblings when one call fails, so only the failing request is answered. */
  function failFirstCall(body: object, status: number): void {
    ctl.expectOne('/api/v1/ops/summary').flush(body, { status, statusText: 'error' });
    ctl.match(() => true); // the cancelled health and audit requests are discarded
  }

  function flushAll(summary: object = SUMMARY): void {
    ctl.expectOne('/api/v1/ops/summary').flush(summary);
    ctl.expectOne('/api/v1/ops/health').flush(HEALTH);
    ctl.expectOne((r) => r.url === '/api/v1/ops/audit-events').flush(AUDIT);
    fixture.detectChanges();
  }

  it('shows a loading state first, then the dashboard', () => {
    expect(el().querySelector('[role="status"]')?.textContent).toContain('Loading');
    flushAll();
    expect(el().querySelector('[role="status"]')?.textContent ?? '').not.toContain('Loading');
    expect(el().textContent).toContain('Completed (24 h)');
    expect(el().textContent).toContain('$1,500.00'); // volume formatted from a string
    expect(el().textContent).toContain('$143,900.00');
    expect(el().textContent).toContain('p50 / p95 / p99');
    expect(el().textContent).toContain('30 / 120 / 150 ms');
    expect(el().textContent).toContain('20.0 %'); // failure rate
    expect(el().textContent).toContain('TRANSACTION_COMPLETED');
  });

  it('renders attention queues as links into the investigation tabs', () => {
    flushAll();
    const links = Array.from(el().querySelectorAll('a.kpi')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/investigations?tab=review');
    expect(links).toContain('/investigations?tab=reconciliation');
    expect(links).toContain('/investigations?tab=failed');
  });

  it('shows the degraded component with its detail', () => {
    flushAll();
    expect(el().textContent).toContain('dead-lettered=1');
    expect(el().textContent).toContain('Degraded');
  });

  it('shows an error with retry when the first load fails, and recovers on retry', () => {
    failFirstCall({ code: 'INTERNAL_ERROR', message: 'Backend unavailable' }, 503);
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Backend unavailable');
    (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
    flushAll();
    expect(el().textContent).toContain('Completed (24 h)');
  });

  it('keeps the last good data and warns when a refresh fails', () => {
    flushAll();
    (Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.includes('Refresh now')) as HTMLButtonElement).click();
    failFirstCall({ code: 'X', message: 'timeout' }, 504);
    fixture.detectChanges();
    expect(el().textContent).toContain('Could not refresh');
    expect(el().textContent).toContain('Completed (24 h)'); // old data still visible
  });

  it('shows empty placeholders when there is no volume, latency or audit data yet', () => {
    ctl.expectOne('/api/v1/ops/summary').flush({ ...SUMMARY, completedVolumeLast24h: [], processingLatency: { sampleSize: 0, averageMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 } });
    ctl.expectOne('/api/v1/ops/health').flush(HEALTH);
    ctl.expectOne((r) => r.url === '/api/v1/ops/audit-events').flush(page([]));
    fixture.detectChanges();
    expect(el().textContent).toContain('No completed volume');
    expect(el().textContent).toContain('No completed transactions yet');
    expect(el().textContent).toContain('No audit events yet');
  });
});
