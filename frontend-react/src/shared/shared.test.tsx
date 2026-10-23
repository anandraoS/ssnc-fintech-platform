import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { formatDate, formatMoney, humanize } from './format';
import { Pager, SortHeader, SortState, StateView, StatusChip } from './components';

describe('formatMoney', () => {
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
});

describe('formatDate / humanize', () => {
  it('formats local date-times with the patterns the screens use', () => {
    const iso = new Date(2026, 0, 5, 9, 8, 7, 45).toISOString();
    expect(formatDate(iso)).toBe('2026-01-05 09:08:07');
    expect(formatDate(iso, 'date')).toBe('2026-01-05');
    expect(formatDate(iso, 'time')).toBe('09:08:07');
    expect(formatDate(iso, 'time-ms')).toBe('09:08:07.045');
    expect(formatDate(iso, 'short')).toBe('01-05 09:08:07');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('garbage')).toBe('garbage');
  });

  it('humanises status codes', () => {
    expect(humanize('RECONCILIATION_REQUIRED')).toBe('Reconciliation required');
  });
});

describe('StatusChip', () => {
  const chip = (status: string) => {
    const { container } = render(<StatusChip status={status} />);
    return container.querySelector('.chip') as HTMLElement;
  };

  it('humanises the label so meaning does not depend on colour alone', () => {
    expect(chip('RECONCILIATION_REQUIRED')).toHaveTextContent('Reconciliation required');
  });

  it('maps statuses to tones', () => {
    expect(chip('COMPLETED')).toHaveClass('ok');
    expect(chip('FAILED')).toHaveClass('bad');
    expect(chip('PENDING_REVIEW')).toHaveClass('warn');
    expect(chip('PROCESSING')).toHaveClass('info');
    expect(chip('CANCELLED')).toHaveClass('muted');
    expect(chip('SOMETHING_ELSE')).toHaveClass('muted');
  });
});

describe('StateView', () => {
  it('shows a polite status region while loading and hides the content', () => {
    render(<StateView state="loading"><p>content</p></StateView>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('content')).toBeNull();
  });

  it('shows an alert with a working retry button on error', async () => {
    const retry = vi.fn();
    render(<StateView state="error" message="Boom" onRetry={retry}><p>content</p></StateView>);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty text, and renders content only when ready', () => {
    const { rerender } = render(<StateView state="empty" emptyText="Empty!"><p>content</p></StateView>);
    expect(screen.getByText('Empty!')).toBeInTheDocument();
    expect(screen.queryByText('content')).toBeNull();
    rerender(<StateView state="ready" emptyText="Empty!"><p>content</p></StateView>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('SortHeader', () => {
  it('cycles ascending -> descending -> unsorted and reports aria-sort', async () => {
    const seen: SortState[] = [];
    function Harness() {
      const [sort, setSort] = useState<SortState>({ active: '', direction: '' });
      return (
        <table><thead><tr>
          <SortHeader id="amount" label="Amount" sort={sort} onSort={(s) => { seen.push(s); setSort(s); }} />
        </tr></thead></table>
      );
    }
    render(<Harness />);
    const header = screen.getByRole('columnheader');
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    expect(header).toHaveAttribute('aria-sort', 'none');
    expect(seen.map((s) => s.direction)).toEqual(['asc', 'desc', '']);
  });
});

describe('Pager', () => {
  it('shows the range, disables the edges and reports page and size changes', async () => {
    const change = vi.fn();
    const { rerender } = render(<Pager page={0} size={10} total={25} label="Pages" onChange={change} />);
    expect(screen.getByText('1–10 of 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(change).toHaveBeenLastCalledWith(1, 10);
    await userEvent.selectOptions(screen.getByRole('combobox'), '50');
    expect(change).toHaveBeenLastCalledWith(0, 50);
    rerender(<Pager page={2} size={10} total={25} label="Pages" onChange={change} />);
    expect(screen.getByText('21–25 of 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('copes with an empty result', () => {
    render(<Pager page={0} size={10} total={0} label="Pages" onChange={vi.fn()} />);
    expect(screen.getByText('0–0 of 0')).toBeInTheDocument();
  });
});
