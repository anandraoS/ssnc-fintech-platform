-- V2 (H2 only): H2 has no partial indexes or triggers, so the PostgreSQL V2 hardening is approximated by a plain index.
-- Uniqueness of the OPEN reconciliation record per transaction is additionally enforced by ReconciliationService.
CREATE INDEX ix_tx_attention ON transactions (status, created_at DESC);
