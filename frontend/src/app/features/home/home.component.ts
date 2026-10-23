import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { DashboardComponent } from './dashboard.component';
import { PortfolioComponent } from './portfolio.component';

/** Staff land on the operational dashboard, customers on their portfolio. */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardComponent, PortfolioComponent],
  template: `
    @if (auth.isStaff()) {
      <app-dashboard />
    } @else {
      <app-portfolio />
    }
  `,
})
export class HomeComponent {
  protected readonly auth = inject(AuthService);
}
