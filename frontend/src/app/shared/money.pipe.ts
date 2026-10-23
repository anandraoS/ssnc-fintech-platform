import { Pipe, PipeTransform } from '@angular/core';

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

/**
 * Formats a decimal STRING (as sent by the API) for display by string manipulation only - the value never passes through
 * a JavaScript number, so there is no floating-point rounding. Locale independent on purpose (grouping with commas).
 */
export function formatMoney(value: string | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    return value;
  }
  const [, sign, integer, fraction] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  const symbol = currency ? (SYMBOLS[currency] ?? '') : '';
  return `${sign}${symbol}${body}${currency && !symbol ? ' ' + currency : ''}`;
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: string | null | undefined, currency?: string | null): string {
    return formatMoney(value, currency);
  }
}
