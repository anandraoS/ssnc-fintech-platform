import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, RouterLink],
  template: `
    <section class="page">
      <h1>Page not found</h1>
      <p class="subtitle">The page you asked for does not exist.</p>
      <a mat-stroked-button routerLink="/">Back to overview</a>
    </section>
  `,
})
export class NotFoundComponent {}

@Component({
  selector: 'app-forbidden',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, RouterLink],
  template: `
    <section class="page">
      <h1>Not permitted</h1>
      <p class="subtitle" role="alert">Your role does not allow access to this page.</p>
      <a mat-stroked-button routerLink="/">Back to overview</a>
    </section>
  `,
})
export class ForbiddenComponent {}
