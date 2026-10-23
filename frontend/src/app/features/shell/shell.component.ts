import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { Role } from '../../core/models';

interface NavItem {
  label: string;
  path: string;
  roles?: Role[];
  exact?: boolean;
}

const NAV: NavItem[] = [
  { label: 'Overview', path: '/', exact: true },
  { label: 'Accounts', path: '/accounts' },
  { label: 'Transactions', path: '/transactions', exact: true },
  { label: 'New transaction', path: '/transactions/new', roles: ['CUSTOMER', 'OPERATIONS_ANALYST', 'ADMIN'] },
  { label: 'Customers', path: '/customers', roles: ['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'] },
  { label: 'Investigations', path: '/investigations', roles: ['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'] },
  { label: 'Audit trail', path: '/audit', roles: ['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'] },
];

/** Application frame: role-aware navigation, responsive sidenav (collapses to an overlay on small screens). */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatListModule, MatSidenavModule, MatToolbarModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <mat-toolbar color="primary" class="bar">
      <button mat-icon-button type="button" class="menu" aria-label="Toggle navigation" (click)="drawer.toggle()">
        <span aria-hidden="true" class="burger">&#9776;</span>
      </button>
      <span class="title">Investment Operations Console</span>
      <span class="demo" title="All data is synthetic">synthetic demo</span>
      <span class="spacer"></span>
      @if (auth.user(); as user) {
        <span class="who">{{ user.username }} · {{ roleLabel() }}</span>
      }
      <button mat-button type="button" (click)="auth.logout()">Sign out</button>
    </mat-toolbar>
    <mat-sidenav-container class="frame">
      <mat-sidenav #drawer [mode]="compact() ? 'over' : 'side'" [opened]="!compact()" role="navigation" aria-label="Main">
        <mat-nav-list>
          @for (item of items(); track item.path) {
            <a mat-list-item [routerLink]="item.path" routerLinkActive="active" #rla="routerLinkActive"
               [routerLinkActiveOptions]="{ exact: !!item.exact }" [attr.aria-current]="rla.isActive ? 'page' : null"
               (click)="compact() && drawer.close()">
              {{ item.label }}
            </a>
          }
        </mat-nav-list>
      </mat-sidenav>
      <mat-sidenav-content>
        <main id="main" tabindex="-1"><router-outlet /></main>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; }
    .bar { gap: 10px; flex: 0 0 auto; }
    .title { font-weight: 500; }
    .demo { font-size: 11px; border: 1px solid rgba(255,255,255,.6); border-radius: 999px; padding: 1px 8px; }
    .spacer { flex: 1; }
    .who { font-size: 13px; }
    .frame { flex: 1; }
    mat-sidenav { width: 220px; }
    .active { background: rgba(23, 50, 77, 0.10); font-weight: 600; }
    main { outline: none; }
    .burger { font-size: 22px; line-height: 1; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    @media (min-width: 900px) { .menu { display: none; } }
    /* small screens: keep only the title and the sign-out button in the toolbar (no horizontal page scroll) */
    @media (max-width: 599px) { .demo, .who { display: none; } .title { font-size: 15px; } }
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly compact = toSignal(
    inject(BreakpointObserver).observe('(max-width: 899px)').pipe(map((s) => s.matches)),
    { initialValue: false },
  );
  protected readonly items = computed(() => NAV.filter((i) => !i.roles || this.auth.hasAny(...i.roles)));
  protected readonly roleLabel = computed(() => this.auth.roles().map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', '));
}
