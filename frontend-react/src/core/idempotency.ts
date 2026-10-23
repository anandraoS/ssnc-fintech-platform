import { newCorrelationId } from './http';

/**
 * Chooses the Idempotency-Key for a submission. The SAME key is reused while the payload is unchanged, so a retry after
 * a timeout, a double click or a lost response can never create a second transaction; an edited payload gets a fresh key
 * (the server would otherwise reject the reuse with 422 IDEMPOTENCY_KEY_REUSED).
 */
export class IdempotencyKeys {
  private lastFingerprint: string | null = null;
  private lastKey: string | null = null;

  keyFor(payload: object): string {
    const fingerprint = JSON.stringify(payload);
    if (this.lastKey === null || fingerprint !== this.lastFingerprint) {
      this.lastKey = `ui-${newCorrelationId()}`;
      this.lastFingerprint = fingerprint;
    }
    return this.lastKey;
  }

  /** Call after a definitive outcome (accepted or rejected) so the next submission is a new logical request. */
  reset(): void {
    this.lastKey = null;
    this.lastFingerprint = null;
  }
}
