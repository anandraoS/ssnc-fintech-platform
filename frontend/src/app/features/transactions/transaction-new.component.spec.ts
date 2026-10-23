import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ACCOUNT, loginAs, page } from '../../../testing/helpers';
import { authInterceptor, correlationInterceptor, errorInterceptor } from '../../core/interceptors';
import { AMOUNT_PATTERN, TransactionNewComponent, transactionShapeValidator } from './transaction-new.component';
import { FormControl, FormGroup } from '@angular/forms';

describe('TransactionNewComponent', () => {
  let fixture: ComponentFixture<TransactionNewComponent>;
  let ctl: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  const second = { ...ACCOUNT, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', accountNumber: 'ACC-1000000002' };

  function setup(): void {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([errorInterceptor, authInterceptor, correlationInterceptor])), provideHttpClientTesting()],
    });
    ctl = TestBed.inject(HttpTestingController);
    loginAs(['CUSTOMER'], 'alice.customer', 'c1');
    fixture = TestBed.createComponent(TransactionNewComponent);
    fixture.detectChanges();
    ctl.expectOne((r) => r.url === '/api/v1/accounts').flush(page([ACCOUNT, second]));
    fixture.detectChanges();
  }

  /** Reaches into the component's protected form for white-box interaction. */
  function form() {
    return (fixture.componentInstance as unknown as { form: FormGroup }).form;
  }

  function fillDeposit(amount = '25.00'): void {
    form().patchValue({ type: 'DEPOSIT', targetAccountId: ACCOUNT.id, amount });
    fixture.detectChanges();
  }

  function submit(): void {
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(() => setup());
  afterEach(() => ctl.verify());

  it('does not call the API when the form is invalid (required fields, shape rules)', () => {
    submit();
    ctl.expectNone('/api/v1/transactions');
    expect(form().invalid).toBeTrue();
  });

  it('derives the currency from the selected account and sends amounts as strings', () => {
    fillDeposit('25.50');
    submit();
    const req = ctl.expectOne('/api/v1/transactions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ type: 'DEPOSIT', sourceAccountId: undefined, targetAccountId: ACCOUNT.id, amount: '25.50', currency: 'USD', memo: undefined });
    expect(req.request.headers.get('Idempotency-Key')).toMatch(/^ui-.{8,}/);
    req.flush({ id: 't1', reference: 'TXN-1', type: 'DEPOSIT', status: 'VALIDATED', amount: '25.50', currency: 'USD' }, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();
    expect(el().textContent).toContain('Accepted');
    expect(el().textContent).toContain('TXN-1');
  });

  it('disables the button while a request is in flight so a double click cannot submit twice', () => {
    fillDeposit();
    submit();
    const button = el().querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    submit(); // a second submit event while pending must be ignored
    const req = ctl.expectOne('/api/v1/transactions');
    req.flush({ id: 't1', reference: 'TXN-1', type: 'DEPOSIT', status: 'VALIDATED', amount: '25.00', currency: 'USD' }, { status: 202, statusText: 'Accepted' });
  });

  it('shows the business rejection (422) with its failure code', () => {
    fillDeposit();
    submit();
    ctl.expectOne('/api/v1/transactions').flush(
      { code: 'TRANSACTION_REJECTED', message: 'rejected', details: { failureCode: 'INSUFFICIENT_FUNDS', failureDetail: 'INSUFFICIENT_FUNDS: Available balance is insufficient', transactionId: 'abc' } },
      { status: 422, statusText: 'Unprocessable Entity' });
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('INSUFFICIENT_FUNDS');
    expect(el().querySelector('a[href="/transactions/abc"]')).not.toBeNull();
  });

  it('reuses the SAME idempotency key when retrying an unchanged payload after a server error', () => {
    fillDeposit();
    submit();
    const first = ctl.expectOne('/api/v1/transactions');
    const key = first.request.headers.get('Idempotency-Key');
    first.flush({ code: 'INTERNAL_ERROR', message: 'boom', correlationId: 'c-1' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(el().textContent).toContain('Could not submit');
    expect(el().textContent).toContain('c-1');
    submit();
    const retry = ctl.expectOne('/api/v1/transactions');
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush({ id: 't1', reference: 'TXN-1', type: 'DEPOSIT', status: 'VALIDATED', amount: '25.00', currency: 'USD' }, { status: 202, statusText: 'Accepted' });
  });

  it('uses a NEW key when the user edits the payload', () => {
    fillDeposit('10.00');
    submit();
    const first = ctl.expectOne('/api/v1/transactions');
    const key = first.request.headers.get('Idempotency-Key');
    first.flush({ code: 'INTERNAL_ERROR', message: 'x' }, { status: 500, statusText: 'Server Error' });
    fillDeposit('11.00');
    submit();
    const second2 = ctl.expectOne('/api/v1/transactions');
    expect(second2.request.headers.get('Idempotency-Key')).not.toBe(key);
    second2.flush({ id: 't2', reference: 'TXN-2', type: 'DEPOSIT', status: 'VALIDATED', amount: '11.00', currency: 'USD' }, { status: 202, statusText: 'Accepted' });
  });

  it('flags a replayed submission', () => {
    fillDeposit();
    submit();
    ctl.expectOne('/api/v1/transactions').flush({ id: 't1', reference: 'TXN-1', type: 'DEPOSIT', status: 'COMPLETED', amount: '25.00', currency: 'USD' },
      { status: 202, statusText: 'Accepted', headers: { 'Idempotent-Replayed': 'true' } });
    fixture.detectChanges();
    expect(el().textContent).toContain('no second transaction was created');
  });
});

describe('amount and shape validation rules', () => {
  it('accepts positive decimals with at most 2 fraction digits', () => {
    for (const ok of ['1', '0.5', '125.50', '999999999999999.99']) {
      expect(AMOUNT_PATTERN.test(ok)).withContext(ok).toBeTrue();
    }
    for (const bad of ['', '-1', '1.005', '1e3', ' 5', '5 ', '1,000', 'abc', '.5']) {
      expect(AMOUNT_PATTERN.test(bad)).withContext(bad).toBeFalse();
    }
  });

  function shape(type: string, source: string, target: string) {
    return transactionShapeValidator(new FormGroup({ type: new FormControl(type), sourceAccountId: new FormControl(source), targetAccountId: new FormControl(target) }));
  }

  it('requires the right accounts for each type', () => {
    expect(shape('DEPOSIT', '', '')).toEqual({ targetRequired: true });
    expect(shape('DEPOSIT', '', 'a')).toBeNull();
    expect(shape('WITHDRAWAL', '', 'a')).toEqual({ sourceRequired: true });
    expect(shape('WITHDRAWAL', 'a', '')).toBeNull();
    expect(shape('TRANSFER', 'a', '')).toEqual({ bothRequired: true });
    expect(shape('TRANSFER', 'a', 'a')).toEqual({ sameAccount: true });
    expect(shape('TRANSFER', 'a', 'b')).toBeNull();
  });
});
