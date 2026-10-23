import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ApiProblem, isApiProblem } from '../../core/models';

const DEMO_USERS = [
  { username: 'alice.customer', hint: 'customer' },
  { username: 'bob.customer', hint: 'customer' },
  { username: 'sam.support', hint: 'support agent' },
  { username: 'omar.ops', hint: 'operations' },
  { username: 'olivia.ops', hint: 'operations (second approver)' },
  { username: 'adam.admin', hint: 'admin' },
];

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  template: `
    <main class="wrap">
      <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate aria-labelledby="login-title">
        <h1 id="login-title">Sign in</h1>
        <p class="muted">Synthetic demo environment. Users and balances are fictional; no real money moves.</p>

        <mat-form-field appearance="outline">
          <mat-label>Username</mat-label>
          <input matInput formControlName="username" autocomplete="username" required />
          @if (form.controls.username.touched && form.controls.username.invalid) {
            <mat-error>Username is required</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Password</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="current-password" required />
          @if (form.controls.password.touched && form.controls.password.invalid) {
            <mat-error>Password is required</mat-error>
          }
        </mat-form-field>

        @if (error(); as e) {
          <p class="error" role="alert">{{ e }}</p>
        }
        <button mat-flat-button type="submit" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>

        <details>
          <summary>Demo users (local profile)</summary>
          <p class="muted">The shared password is configured with LOCAL_DEMO_PASSWORD (see README).</p>
          <ul>
            @for (u of demoUsers; track u.username) {
              <li><button type="button" class="link" (click)="fill(u.username)">{{ u.username }}</button> <span class="muted">{{ u.hint }}</span></li>
            }
          </ul>
        </details>
      </form>
    </main>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
    form { width: min(420px, 100%); display: flex; flex-direction: column; gap: 6px; }
    h1 { margin: 0; font-size: 22px; font-weight: 500; }
    .error { color: var(--bad); margin: 0; }
    .link { background: none; border: 0; color: #0b5cad; cursor: pointer; text-decoration: underline; padding: 0; font: inherit; }
    details { margin-top: 12px; font-size: 13px; }
  `,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly demoUsers = DEMO_USERS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.maxLength(64)]],
    password: ['', [Validators.required, Validators.maxLength(128)]],
  });

  protected fill(username: string): void {
    this.form.patchValue({ username });
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const { username, password } = this.form.getRawValue();
    this.auth.login(username, password).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        // only follow in-app relative paths (prevents an open redirect through a crafted returnUrl)
        void this.router.navigateByUrl(returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/');
      },
      error: (e: unknown) => {
        this.busy.set(false);
        const problem: ApiProblem | null = isApiProblem(e) ? e : null;
        this.error.set(
          problem?.status === 401 ? 'Invalid username or password.'
            : problem?.status === 429 ? 'Too many attempts. Please wait a moment and try again.'
            : (problem?.message ?? 'Sign-in failed.'),
        );
      },
    });
  }
}
