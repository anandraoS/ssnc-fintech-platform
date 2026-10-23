import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { formatMoney, MoneyPipe } from './money.pipe';
import { StateViewComponent, ViewState } from './state-view.component';
import { StatusChipComponent } from './status-chip.component';

describe('formatMoney / MoneyPipe', () => {
  it('formats decimal strings without going through floating point', () => {
    expect(formatMoney('1234567.89', 'USD')).toBe('$1,234,567.89');
    expect(formatMoney('0.10', 'EUR')).toBe('€0.10');
    expect(formatMoney('99999999999999.99', 'GBP')).toBe('£99,999,999,999,999.99'); // beyond 2^53 precision, still exact
    expect(formatMoney('500000.00', 'INR')).toBe('₹500,000.00');
  });

  it('keeps the sign, appends unknown currency codes and handles empty values', () => {
    expect(formatMoney('-12.5', 'USD')).toBe('-$12.5');
    expect(formatMoney('10.00', 'CHF')).toBe('10.00 CHF');
    expect(formatMoney('10.00')).toBe('10.00');
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney('', 'USD')).toBe('—');
    expect(formatMoney('not-a-number', 'USD')).toBe('not-a-number');
  });

  it('works as a pipe', () => {
    expect(new MoneyPipe().transform('1000.00', 'USD')).toBe('$1,000.00');
  });
});

describe('StatusChipComponent', () => {
  function chip(status: string): HTMLElement {
    const fixture = TestBed.createComponent(StatusChipComponent);
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.chip') as HTMLElement;
  }

  it('humanises the label so meaning does not depend on colour alone', () => {
    expect(chip('RECONCILIATION_REQUIRED').textContent?.trim()).toBe('Reconciliation required');
  });

  it('maps statuses to tones', () => {
    expect(chip('COMPLETED').className).toContain('ok');
    expect(chip('FAILED').className).toContain('bad');
    expect(chip('PENDING_REVIEW').className).toContain('warn');
    expect(chip('PROCESSING').className).toContain('info');
    expect(chip('CANCELLED').className).toContain('muted');
    expect(chip('SOMETHING_ELSE').className).toContain('muted');
  });
});

@Component({
  imports: [StateViewComponent],
  template: `<app-state-view [state]="state" message="Boom" emptyText="Empty!" (retry)="retried = retried + 1"><p id="content">content</p></app-state-view>`,
})
class HostComponent {
  state: ViewState = 'loading';
  retried = 0;
}

describe('StateViewComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
  });

  it('shows a polite status region while loading', () => {
    fixture.detectChanges();
    expect(el().querySelector('[role="status"]')).not.toBeNull();
    expect(el().querySelector('#content')).toBeNull();
  });

  it('shows an alert with a working retry button on error', () => {
    fixture.componentInstance.state = 'error';
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Boom');
    (el().querySelector('button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.retried).toBe(1);
  });

  it('shows the empty text, and projects content only when ready', () => {
    fixture.componentInstance.state = 'empty';
    fixture.detectChanges();
    expect(el().textContent).toContain('Empty!');
    expect(el().querySelector('#content')).toBeNull();
    fixture.componentInstance.state = 'ready';
    fixture.detectChanges();
    expect(el().querySelector('#content')).not.toBeNull();
  });
});
