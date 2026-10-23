-- V1: core schema. Portable between PostgreSQL (production) and H2 in PostgreSQL mode (local/tests).
-- Money: NUMERIC(19,4), never floating point. Timestamps: UTC.
-- Defence in depth: business rules are enforced in the domain layer AND by constraints here.

CREATE TABLE customers (
    id            UUID                     NOT NULL,
    customer_ref  VARCHAR(32)              NOT NULL,
    legal_name    VARCHAR(200)             NOT NULL,
    email         VARCHAR(254)             NOT NULL,
    phone         VARCHAR(32),
    tax_id_last4  VARCHAR(4),
    status        VARCHAR(20)              NOT NULL,
    version       BIGINT                   NOT NULL DEFAULT 0,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at    TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_customers PRIMARY KEY (id),
    CONSTRAINT uq_customers_ref UNIQUE (customer_ref),
    CONSTRAINT uq_customers_email UNIQUE (email),
    CONSTRAINT ck_customers_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);

CREATE TABLE accounts (
    id                      UUID                     NOT NULL,
    account_number          VARCHAR(20)              NOT NULL,
    customer_id             UUID                     NOT NULL,
    account_type            VARCHAR(20)              NOT NULL,
    status                  VARCHAR(24)              NOT NULL,
    status_reason           VARCHAR(255),
    currency                VARCHAR(3)               NOT NULL,
    balance                 NUMERIC(19, 4)           NOT NULL,
    minimum_balance         NUMERIC(19, 4)           NOT NULL DEFAULT 0,
    daily_withdrawal_limit  NUMERIC(19, 4)           NOT NULL,
    version                 BIGINT                   NOT NULL DEFAULT 0,
    opened_at               TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_accounts PRIMARY KEY (id),
    CONSTRAINT uq_accounts_number UNIQUE (account_number),
    CONSTRAINT fk_accounts_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
    CONSTRAINT ck_accounts_type CHECK (account_type IN ('BROKERAGE', 'RETIREMENT', 'MONEY_MARKET')),
    CONSTRAINT ck_accounts_status CHECK (status IN ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
    -- last line of defence against overdraft even if application code has a bug
    CONSTRAINT ck_accounts_balance_nonneg CHECK (balance >= 0),
    CONSTRAINT ck_accounts_minimum_nonneg CHECK (minimum_balance >= 0),
    CONSTRAINT ck_accounts_limit_nonneg CHECK (daily_withdrawal_limit >= 0)
);
CREATE INDEX ix_accounts_customer ON accounts (customer_id);
CREATE INDEX ix_accounts_status_type ON accounts (status, account_type);

CREATE TABLE transactions (
    id                 UUID                     NOT NULL,
    reference          VARCHAR(30)              NOT NULL,
    transaction_type   VARCHAR(20)              NOT NULL,
    status             VARCHAR(30)              NOT NULL,
    source_account_id  UUID,
    target_account_id  UUID,
    amount             NUMERIC(19, 4)           NOT NULL,
    currency           VARCHAR(3)               NOT NULL,
    memo               VARCHAR(140),
    submitted_by       VARCHAR(100)             NOT NULL,
    reviewed_by        VARCHAR(100),
    failure_code       VARCHAR(50),
    failure_detail     VARCHAR(500),
    funds_reserved     BOOLEAN                  NOT NULL DEFAULT FALSE,
    version            BIGINT                   NOT NULL DEFAULT 0,
    created_at         TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at         TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at       TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_transactions PRIMARY KEY (id),
    CONSTRAINT uq_transactions_reference UNIQUE (reference),
    CONSTRAINT fk_tx_source FOREIGN KEY (source_account_id) REFERENCES accounts (id),
    CONSTRAINT fk_tx_target FOREIGN KEY (target_account_id) REFERENCES accounts (id),
    CONSTRAINT ck_tx_type CHECK (transaction_type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER')),
    CONSTRAINT ck_tx_status CHECK (status IN ('RECEIVED', 'VALIDATED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED',
                                              'PENDING_REVIEW', 'RECONCILIATION_REQUIRED', 'CANCELLED')),
    CONSTRAINT ck_tx_amount_positive CHECK (amount > 0),
    CONSTRAINT ck_tx_accounts_match_type CHECK (
        (transaction_type = 'DEPOSIT' AND target_account_id IS NOT NULL AND source_account_id IS NULL)
        OR (transaction_type = 'WITHDRAWAL' AND source_account_id IS NOT NULL AND target_account_id IS NULL)
        OR (transaction_type = 'TRANSFER' AND source_account_id IS NOT NULL AND target_account_id IS NOT NULL
            AND source_account_id <> target_account_id))
);
-- history per account (newest first) and operational queues
CREATE INDEX ix_tx_source_created ON transactions (source_account_id, created_at DESC);
CREATE INDEX ix_tx_target_created ON transactions (target_account_id, created_at DESC);
CREATE INDEX ix_tx_status_created ON transactions (status, created_at DESC);
CREATE INDEX ix_tx_created ON transactions (created_at DESC);

CREATE TABLE transaction_attempts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    transaction_id  UUID                     NOT NULL,
    attempt_no      INTEGER                  NOT NULL,
    stage           VARCHAR(30)              NOT NULL,
    outcome         VARCHAR(30)              NOT NULL,
    detail          VARCHAR(500),
    started_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at     TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_tx_attempts PRIMARY KEY (id),
    CONSTRAINT fk_attempt_tx FOREIGN KEY (transaction_id) REFERENCES transactions (id),
    CONSTRAINT uq_attempt_no UNIQUE (transaction_id, attempt_no)
);

-- Idempotency: one row per (principal, key). The UNIQUE constraint is the concurrency arbiter.
CREATE TABLE idempotency_records (
    id               UUID                     NOT NULL,
    principal        VARCHAR(100)             NOT NULL,
    idempotency_key  VARCHAR(80)              NOT NULL,
    request_hash     VARCHAR(64)              NOT NULL,
    transaction_id   UUID                     NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_idempotency PRIMARY KEY (id),
    CONSTRAINT uq_idempotency_principal_key UNIQUE (principal, idempotency_key),
    CONSTRAINT fk_idem_tx FOREIGN KEY (transaction_id) REFERENCES transactions (id)
);
CREATE INDEX ix_idempotency_created ON idempotency_records (created_at);

-- Double-entry style ledger. transaction_id is NULL only for OPENING balances.
CREATE TABLE ledger_entries (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    transaction_id  UUID,
    account_id      UUID                     NOT NULL,
    entry_type      VARCHAR(20)              NOT NULL,
    amount          NUMERIC(19, 4)           NOT NULL,
    balance_after   NUMERIC(19, 4)           NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_ledger PRIMARY KEY (id),
    CONSTRAINT fk_ledger_tx FOREIGN KEY (transaction_id) REFERENCES transactions (id),
    CONSTRAINT fk_ledger_account FOREIGN KEY (account_id) REFERENCES accounts (id),
    CONSTRAINT ck_ledger_type CHECK (entry_type IN ('OPENING', 'DEBIT', 'CREDIT', 'REVERSAL_CREDIT')),
    CONSTRAINT ck_ledger_amount CHECK (amount >= 0),
    -- a transaction can apply (or reverse) at most one entry per account: blocks double application
    CONSTRAINT uq_ledger_tx_account_type UNIQUE (transaction_id, account_id, entry_type)
);
CREATE INDEX ix_ledger_account ON ledger_entries (account_id, id);

CREATE TABLE audit_events (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    occurred_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    actor           VARCHAR(100)             NOT NULL,
    actor_roles     VARCHAR(200),
    action          VARCHAR(60)              NOT NULL,
    entity_type     VARCHAR(30)              NOT NULL,
    entity_id       VARCHAR(64)              NOT NULL,
    correlation_id  VARCHAR(64),
    details         VARCHAR(2000),
    CONSTRAINT pk_audit PRIMARY KEY (id)
);
CREATE INDEX ix_audit_entity ON audit_events (entity_type, entity_id, id);
CREATE INDEX ix_audit_occurred ON audit_events (occurred_at DESC);
CREATE INDEX ix_audit_action ON audit_events (action, occurred_at DESC);

CREATE TABLE reconciliation_records (
    id               UUID                     NOT NULL,
    transaction_id   UUID                     NOT NULL,
    status           VARCHAR(12)              NOT NULL,
    reason_code      VARCHAR(50)              NOT NULL,
    detail           VARCHAR(500),
    opened_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    resolved_at      TIMESTAMP WITH TIME ZONE,
    resolved_by      VARCHAR(100),
    resolution       VARCHAR(30),
    resolution_note  VARCHAR(500),
    version          BIGINT                   NOT NULL DEFAULT 0,
    CONSTRAINT pk_reconciliation PRIMARY KEY (id),
    CONSTRAINT fk_recon_tx FOREIGN KEY (transaction_id) REFERENCES transactions (id),
    CONSTRAINT ck_recon_status CHECK (status IN ('OPEN', 'RESOLVED'))
);
CREATE INDEX ix_recon_status ON reconciliation_records (status, opened_at);
CREATE INDEX ix_recon_tx ON reconciliation_records (transaction_id);

-- Transactional outbox: written in the same DB transaction as the state change, dispatched afterwards.
CREATE TABLE outbox_events (
    id              UUID                     NOT NULL,
    aggregate_type  VARCHAR(30)              NOT NULL,
    aggregate_id    UUID                     NOT NULL,
    event_type      VARCHAR(50)              NOT NULL,
    payload         VARCHAR(2000),
    status          VARCHAR(12)              NOT NULL,
    attempts        INTEGER                  NOT NULL DEFAULT 0,
    last_error      VARCHAR(500),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    available_at    TIMESTAMP WITH TIME ZONE NOT NULL,
    dispatched_at   TIMESTAMP WITH TIME ZONE,
    version         BIGINT                   NOT NULL DEFAULT 0,
    CONSTRAINT pk_outbox PRIMARY KEY (id),
    CONSTRAINT ck_outbox_status CHECK (status IN ('NEW', 'DISPATCHED', 'DEAD'))
);
CREATE INDEX ix_outbox_status_available ON outbox_events (status, available_at);
