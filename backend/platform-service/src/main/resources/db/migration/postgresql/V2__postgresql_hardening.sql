-- V2 (PostgreSQL only): features that H2 cannot express. Selected through the Flyway {vendor} location.

-- At most one OPEN reconciliation record per transaction (partial unique index).
CREATE UNIQUE INDEX uq_recon_open_per_tx ON reconciliation_records (transaction_id) WHERE status = 'OPEN';

-- Hot-path partial index for the operations "attention" queues.
CREATE INDEX ix_tx_attention ON transactions (created_at DESC)
    WHERE status IN ('PENDING_REVIEW', 'RECONCILIATION_REQUIRED', 'FAILED');

-- Append-only audit trail: updates and deletes are rejected at the database level.
CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
