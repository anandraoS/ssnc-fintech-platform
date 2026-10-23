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

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export type DateStyle = 'date' | 'datetime' | 'time' | 'time-ms' | 'short';

/** Local-time formatting that matches the Angular date pipe patterns used by the Angular app. */
export function formatDate(iso: string | null | undefined, style: DateStyle = 'datetime'): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  switch (style) {
    case 'date':
      return ymd;
    case 'time':
      return hms;
    case 'time-ms':
      return `${hms}.${pad(d.getMilliseconds(), 3)}`;
    case 'short':
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms}`;
    default:
      return `${ymd} ${hms}`;
  }
}

/** "RECONCILIATION_REQUIRED" -> "Reconciliation required". */
export function humanize(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
