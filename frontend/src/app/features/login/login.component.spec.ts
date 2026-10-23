import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { authInterceptor, correlationInterceptor, errorInterceptor } from '../../core/interceptors';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let ctl: HttpTestingController;
  let navigate: jasmine.Spy;
  const el = () => fixture.nativeElement as HTMLElement;

  function setup(returnUrl: string | null = null): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([errorInterceptor, authInterceptor, correlationInterceptor])),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}) } } },
      ],
    });
    ctl = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  }

  function type(selector: string, value: string): void {
    const input = el().querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function submit(): void {
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  afterEach(() => ctl.verify());

  it('does not call the server with empty credentials and shows field errors', () => {
    setup();
    submit();
    ctl.expectNone('/api/v1/auth/token');
    expect(el().textContent).toContain('Username is required');
    expect(el().textContent).toContain('Password is required');
  });

  it('shows a generic message on 401 and does not leak which field was wrong', () => {
    setup();
    type('input[formControlName="username"]', 'alice.customer');
    type('input[formControlName="password"]', 'wrong');
    submit();
    ctl.expectOne('/api/v1/auth/token').flush({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Invalid username or password');
    expect((el().querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBeFalse();
  });

  it('explains rate limiting', () => {
    setup();
    type('input[formControlName="username"]', 'a');
    type('input[formControlName="password"]', 'b');
    submit();
    ctl.expectOne('/api/v1/auth/token').flush({ code: 'RATE_LIMITED', message: 'x' }, { status: 429, statusText: 'Too Many Requests' });
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Too many attempts');
  });

  it('navigates home after a successful sign-in', () => {
    setup();
    type('input[formControlName="username"]', 'omar.ops');
    type('input[formControlName="password"]', 'secret');
    submit();
    ctl.expectOne('/api/v1/auth/token').flush({ accessToken: 't', tokenType: 'Bearer', expiresInSeconds: 600, username: 'omar.ops', roles: ['OPERATIONS_ANALYST'], customerId: null });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('follows a safe in-app returnUrl but ignores external or protocol-relative ones (open-redirect guard)', () => {
    for (const [input, expected] of [['/accounts', '/accounts'], ['https://evil.example', '/'], ['//evil.example', '/'], ['javascript:alert(1)', '/']] as const) {
      TestBed.resetTestingModule();
      setup(input);
      type('input[formControlName="username"]', 'u');
      type('input[formControlName="password"]', 'p');
      submit();
      ctl.expectOne('/api/v1/auth/token').flush({ accessToken: 't', tokenType: 'Bearer', expiresInSeconds: 600, username: 'u', roles: ['CUSTOMER'], customerId: 'c' });
      expect(navigate).withContext(input).toHaveBeenCalledWith(expected);
      ctl.verify();
    }
  });
});
