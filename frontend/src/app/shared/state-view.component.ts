import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

export type ViewState = 'loading' | 'error' | 'empty' | 'ready';

/** One consistent place for loading / error (with retry) / empty / content states. Announces changes to screen readers. */
@Component({
  selector: 'app-state-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressSpinnerModule],
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="box" role="status" aria-live="polite">
          <mat-spinner diameter="28" aria-label="Loading"></mat-spinner>
          <span>{{ loadingText() }}</span>
        </div>
      }
      @case ('error') {
        <div class="box error" role="alert">
          <span>{{ message() || 'Something went wrong.' }}</span>
          <button mat-stroked-button type="button" (click)="retry.emit()">Retry</button>
        </div>
      }
      @case ('empty') {
        <div class="box muted" role="status">{{ emptyText() }}</div>
      }
      @default {
        <ng-content />
      }
    }
  `,
  styles: `
    .box { display: flex; align-items: center; gap: 12px; padding: 18px; border: 1px dashed var(--rule); border-radius: 8px; background: #fff; }
    .error { color: var(--bad); border-color: #f1b3ae; background: #fdf5f4; }
    .muted { color: var(--muted); }
  `,
})
export class StateViewComponent {
  readonly state = input.required<ViewState>();
  readonly message = input<string>('');
  readonly emptyText = input<string>('Nothing to show yet.');
  readonly loadingText = input<string>('Loading…');
  readonly retry = output<void>();
}
