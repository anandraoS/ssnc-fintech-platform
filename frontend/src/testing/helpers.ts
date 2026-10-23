import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../app/core/auth.service';
import { Role } from '../app/core/models';

/** Signs the AuthService in through the real login call (flushed by the testing backend). */
export function loginAs(roles: Role[], username = 'tester', customerId: string | null = null): void {
  const auth = TestBed.inject(AuthService);
  const http = TestBed.inject(HttpTestingController);
  auth.login(username, 'x').subscribe();
  http.expectOne('/api/v1/auth/token').flush({
    accessToken: 'test-token', tokenType: 'Bearer', expiresInSeconds: 1800, username, roles, customerId,
  });
}

export function page<T>(items: T[], extra: Partial<{ page: number; size: number; totalElements: number; totalPages: number }> = {}) {
  return { items, page: 0, size: 20, totalElements: items.length, totalPages: 1, ...extra };
}

export const TX = {
  id: '11111111-1111-4111-8111-111111111111', reference: 'TXN-ABC123', type: 'WITHDRAWAL' as const,
  status: 'COMPLETED' as const, sourceAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amount: '25.00', currency: 'USD',
  submittedBy: 'alice.customer', version: 1, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:01Z',
  completedAt: '2026-01-01T10:00:01Z',
};

export const ACCOUNT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountNumber: 'ACC-1000000001', customerId: 'c1', accountType: 'BROKERAGE' as const,
  status: 'ACTIVE' as const, currency: 'USD', balance: '1000.00', availableBalance: '1000.00', minimumBalance: '0.00',
  dailyWithdrawalLimit: '10000.00', version: 1, openedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
