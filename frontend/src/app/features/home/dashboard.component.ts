import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { forkJoin, interval } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuditRow, PlatformHealth, Summary, isApiProblem } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { StateViewComponent, ViewState } from '../../shared/state-view.component';
import { StatusChipComponent } from '../../shared/status-chip.component';

const REFRESH_MS = 15_000;

/**
 * Operational dashboard: volumes, statuses, attention queues, latency, error rates, service health, recent audit.
 * Auto-refreshes while visible; a failed refresh keeps the last good data on screen and shows a non-blocking warning.
 */
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatButtonModule, MoneyPipe, RouterLink, StateViewComponent, StatusChipComponent],
  template: `
    <section class="page">
      <div class="head">
        <div>
          <h1>Operations overview</h1>
          <p class="subtitle">
            @if (summary(); as s) { Updated {{ s.generatedAt | date: 'HH:mm:ss' }} · refreshes every 15 s } @else { Platform health, volumes and exceptions }
          </p>
        </div>
        <button mat-stroked-button type="button" (click)="load()">Refresh now</button>
      </div>

      @if (refreshError()) {
        <p class="warn" role="alert">Could not refresh: {{ refreshError() }} — showing the last data received.</p>
      }

      <app-state-view [state]="viewState()" [message]="errorMessage()" (retry)="load()" emptyText="No data yet.">
        @if (summary(); as s) {
          <div class="grid cols-4 kpis">
            <a class="card kpi" routerLink="/transactions" [queryParams]="{ status: 'COMPLETED' }">
              <span class="label">Completed (24 h)</span><strong>{{ s.completedLast24h }}</strong>
            </a>
            <a class="card kpi bad" routerLink="/investigations" [queryParams]="{ tab: 'failed' }">
              <span class="label">Failed (24 h)</span><strong>{{ s.failedLast24h }}</strong>
            </a>
            <a class="card kpi warn" routerLink="/investigations" [queryParams]="{ tab: 'review' }">
              <span class="label">Pending review</span><strong>{{ s.pendingReview }}</strong>
            </a>
            <a class="card kpi warn" routerLink="/investigations" [queryParams]="{ tab: 'reconciliation' }">
              <span class="label">Reconciliation required</span><strong>{{ s.reconciliationRequired }}</strong>
            </a>
          </div>

          <div class="grid cols-2 row">
            <section class="card" aria-labelledby="h-status">
              <h2 id="h-status">Transactions by status</h2>
              <ul class="bars">
                @for (row of statusRows(); track row.status) {
                  <li>
                    <span class="name"><app-status-chip [status]="row.status" /></span>
                    <span class="bar" aria-hidden="true"><i [style.width.%]="row.pct"></i></span>
                    <span class="num">{{ row.count }}</span>
                  </li>
                }
              </ul>
            </section>

            <section class="card" aria-labelledby="h-health">
              <h2 id="h-health">Service health
                @if (health(); as h) { <app-status-chip [status]="h.status" /> }
              </h2>
              @if (health(); as h) {
                <ul class="health">
                  @for (c of h.components; track c.name) {
                    <li><app-status-chip [status]="c.status" /> <strong>{{ c.name }}</strong> <span class="muted">{{ c.detail }}</span></li>
                  }
                </ul>
              } @else {
                <p class="muted">Health data unavailable.</p>
              }
            </section>
          </div>

          <div class="grid cols-2 row">
            <section class="card" aria-labelledby="h-perf">
              <h2 id="h-perf">Processing latency &amp; error rates</h2>
              @if (s.processingLatency.sampleSize === 0) {
                <p class="muted">No completed transactions yet.</p>
              } @else {
                <dl class="facts">
                  <dt>Average</dt><dd>{{ s.processingLatency.averageMs | number: '1.0-0' }} ms</dd>
                  <dt>p50 / p95 / p99</dt><dd>{{ s.processingLatency.p50Ms }} / {{ s.processingLatency.p95Ms }} / {{ s.processingLatency.p99Ms }} ms</dd>
                  <dt>Sample</dt><dd>last {{ s.processingLatency.sampleSize }} completed transactions</dd>
                </dl>
              }
              <dl class="facts">
                <dt>Transaction failure rate (24 h)</dt><dd>{{ pct(s.transactionFailureRateLast24h) }}</dd>
                <dt>HTTP 5xx rate (since start)</dt><dd>{{ pct(s.http.errorRate) }} <span class="muted">({{ s.http.serverErrors }} of {{ s.http.totalRequests }})</span></dd>
              </dl>
            </section>

            <section class="card" aria-labelledby="h-vol">
              <h2 id="h-vol">Completed volume (24 h)</h2>
              @if (s.completedVolumeLast24h.length === 0) {
                <p class="muted">No completed volume in the last 24 hours.</p>
              } @else {
                <table class="plain">
                  <caption class="sr-only">Completed volume by type and currency</caption>
                  <thead><tr><th scope="col">Type</th><th scope="col">Currency</th><th scope="col" class="amount">Count</th><th scope="col" class="amount">Volume</th></tr></thead>
                  <tbody>
                    @for (v of s.completedVolumeLast24h; track v.type + v.currency) {
                      <tr><td>{{ v.type }}</td><td>{{ v.currency }}</td><td class="amount">{{ v.count }}</td><td class="amount">{{ v.volume | money: v.currency }}</td></tr>
                    }
                  </tbody>
                </table>
              }
              <h3>Accounts</h3>
              <p>
                @for (a of accountRows(); track a.status) { <span class="pill"><app-status-chip [status]="a.status" /> {{ a.count }}</span> }
              </p>
              <p class="muted">Total balances:
                @for (b of s.totalBalances; track b.currency) { <strong class="pill">{{ b.total | money: b.currency }}</strong> }
              </p>
            </section>
          </div>

          <section class="card row" aria-labelledby="h-audit">
            <h2 id="h-audit">Recent audit events <a routerLink="/audit" class="more">View all</a></h2>
            @if (audit().length === 0) {
              <p class="muted">No audit events yet.</p>
            } @else {
              <table class="plain">
                <caption class="sr-only">Most recent audit events</caption>
                <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th></tr></thead>
                <tbody>
                  @for (e of audit(); track e.id) {
                    <tr>
                      <td>{{ e.occurredAt | date: 'MM-dd HH:mm:ss' }}</td><td>{{ e.actor }}</td>
                      <td><span class="mono">{{ e.action }}</span></td><td><span class="muted">{{ e.entityType }}</span></td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>
        }
      </app-state-view>
    </section>
  `,
  styles: `
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .warn { color: #8a4a05; background: #fff3df; border: 1px solid #f0cf9a; padding: 8px 12px; border-radius: 6px; }
    .kpis { margin-bottom: 14px; }
    .kpi { text-decoration: none; color: inherit; display: flex; flex-direction: column; gap: 4px; }
    .kpi:hover { border-color: #17324d; }
    .kpi .label { color: var(--muted); font-size: 13px; }
    .kpi strong { font-size: 30px; font-weight: 500; }
    .kpi.bad strong { color: var(--bad); }
    .kpi.warn strong { color: var(--warn); }
    .row { margin-top: 14px; }
    h2 { font-size: 15px; font-weight: 600; margin: 0 0 10px; display: flex; gap: 10px; align-items: center; }
    h3 { font-size: 13px; margin: 14px 0 6px; color: var(--muted); font-weight: 600; }
    .bars, .health { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
    .bars li { display: grid; grid-template-columns: 190px 1fr 50px; align-items: center; gap: 10px; }
    .bar { background: #eef0f3; height: 10px; border-radius: 5px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: #17324d; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .health li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    dl.facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0 0 10px; }
    dt { color: var(--muted); } dd { margin: 0; }
    table.plain { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.plain th, table.plain td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); }
    table.plain .amount { text-align: right; }
    .pill { margin-right: 10px; display: inline-block; }
    .more { font-size: 12px; font-weight: 400; }
  `,
})
export class DashboardComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly summary = signal<Summary | null>(null);
  protected readonly health = signal<PlatformHealth | null>(null);
  protected readonly audit = signal<AuditRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly refreshError = signal('');

  protected readonly viewState = computed<ViewState>(() => {
    if (this.summary()) {
      return 'ready';
    }
    return this.loading() ? 'loading' : this.errorMessage() ? 'error' : 'empty';
  });

  protected readonly statusRows = computed(() => {
    const counts = this.summary()?.transactionsByStatus ?? {};
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts).map(([status, count]) => ({ status, count, pct: (count / max) * 100 }));
  });
  protected readonly accountRows = computed(() =>
    Object.entries(this.summary()?.accountsByStatus ?? {}).map(([status, count]) => ({ status, count })),
  );

  constructor() {
    this.load();
    interval(REFRESH_MS).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        this.load();
      }
    });
  }

  protected pct(rate: number): string {
    return `${(rate * 100).toFixed(1)} %`;
  }

  load(): void {
    forkJoin({
      summary: this.api.summary(),
      health: this.api.health(),
      audit: this.api.auditEvents({ size: 8, sort: 'occurredAt,desc' }),
    }).subscribe({
      next: (r) => {
        this.summary.set(r.summary);
        this.health.set(r.health);
        this.audit.set(r.audit.items);
        this.loading.set(false);
        this.errorMessage.set('');
        this.refreshError.set('');
      },
      error: (e: unknown) => {
        const message = isApiProblem(e) ? e.message : 'The dashboard data could not be loaded.';
        this.loading.set(false);
        if (this.summary()) {
          this.refreshError.set(message);
        } else {
          this.errorMessage.set(message);
        }
      },
    });
  }
}
