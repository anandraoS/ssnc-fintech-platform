import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const TONES: Record<string, 'ok' | 'bad' | 'warn' | 'info' | 'muted'> = {
  COMPLETED: 'ok', ACTIVE: 'ok', UP: 'ok', RESOLVED: 'ok', DISPATCHED: 'ok',
  FAILED: 'bad', REJECTED: 'bad', DOWN: 'bad', DEAD: 'bad', SUSPENDED: 'bad',
  PENDING_REVIEW: 'warn', RECONCILIATION_REQUIRED: 'warn', DEGRADED: 'warn', ATTENTION: 'warn', OPEN: 'warn',
  PENDING_ACTIVATION: 'warn',
  PROCESSING: 'info', VALIDATED: 'info', RECEIVED: 'info', NEW: 'info',
  CANCELLED: 'muted', CLOSED: 'muted',
};

/** Status label. Colour is reinforced by the text itself, so meaning never depends on colour alone (WCAG 1.4.1). */
@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip" [class]="tone()">{{ label() }}</span>`,
  styles: `
    .chip { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; border: 1px solid; white-space: nowrap; }
    .ok { color: #0b5d56; background: #e3f4f1; border-color: #9fd6cf; }
    .bad { color: #8f1d14; background: #fdeceb; border-color: #f1b3ae; }
    .warn { color: #8a4a05; background: #fff3df; border-color: #f0cf9a; }
    .info { color: #1b3f9a; background: #e8eefc; border-color: #b6c7f2; }
    .muted { color: #4b5563; background: #eef0f3; border-color: #cfd5dc; }
  `,
})
export class StatusChipComponent {
  readonly status = input.required<string>();
  protected readonly label = computed(() => this.status().replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()));
  protected readonly tone = computed(() => TONES[this.status()] ?? 'muted');
}
