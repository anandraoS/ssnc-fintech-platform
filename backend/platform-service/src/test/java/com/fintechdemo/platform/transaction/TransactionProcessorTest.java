package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.clearing.ClearingClient;
import com.fintechdemo.platform.clearing.ClearingClient.ClearingResult;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.ops.PlatformMetrics;
import com.fintechdemo.platform.support.NoOpTransactions;
import com.fintechdemo.platform.transaction.SupportRepositories.AttemptRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Outcome mapping of the processor, with every collaborator mocked (Mockito) and no database. */
class TransactionProcessorTest {

    private static final Instant NOW = Instant.parse("2026-01-01T00:00:00Z");
    private TransactionRepository transactions;
    private LedgerService ledger;
    private ClearingClient clearing;
    private ReconciliationService reconciliation;
    private TransactionProcessor processor;

    @BeforeEach
    void setUp() {
        transactions = mock(TransactionRepository.class);
        ledger = mock(LedgerService.class);
        clearing = mock(ClearingClient.class);
        reconciliation = mock(ReconciliationService.class);
        processor = new TransactionProcessor(transactions, ledger, clearing, mock(AttemptRepository.class), reconciliation,
                mock(AuditService.class), mock(PlatformMetrics.class), NoOpTransactions.template(), Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private FinancialTransaction validated(TransactionType type) {
        FinancialTransaction tx = new FinancialTransaction(UUID.randomUUID(), "TXN-REF", type,
                type == TransactionType.DEPOSIT ? null : UUID.randomUUID(), type == TransactionType.WITHDRAWAL ? null : UUID.randomUUID(),
                new BigDecimal("25.0000"), "USD", null, "alice", NOW);
        tx.transitionTo(TransactionStatus.VALIDATED, NOW);
        when(transactions.findById(tx.getId())).thenReturn(Optional.of(tx));
        return tx;
    }

    @Test
    void depositCompletesInOneStepWithoutCallingTheNetwork() {
        FinancialTransaction tx = validated(TransactionType.DEPOSIT);
        processor.process(tx.getId());
        verify(ledger).applyDeposit(tx);
        verifyNoInteractions(clearing);
        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.COMPLETED);
    }

    @Test
    void transferCompletesInOneStepWithoutCallingTheNetwork() {
        FinancialTransaction tx = validated(TransactionType.TRANSFER);
        processor.process(tx.getId());
        verify(ledger).applyTransfer(tx);
        verifyNoInteractions(clearing);
        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.COMPLETED);
    }

    @Test
    @DisplayName("withdrawal: funds are reserved BEFORE the network call; authorized => COMPLETED, no refund")
    void withdrawalAuthorized() {
        FinancialTransaction tx = validated(TransactionType.WITHDRAWAL);
        when(clearing.authorize(any())).thenReturn(new ClearingResult.Authorized("AUTH-1"));
        processor.process(tx.getId());
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(ledger, clearing);
        order.verify(ledger).reserveWithdrawal(tx);
        order.verify(clearing).authorize(any());
        verify(ledger, never()).reverseWithdrawal(any());
        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.COMPLETED);
    }

    @Test
    void withdrawalDeclinedRefundsAndFails() {
        FinancialTransaction tx = validated(TransactionType.WITHDRAWAL);
        when(clearing.authorize(any())).thenReturn(new ClearingResult.Declined("RISK_DECLINE"));
        processor.process(tx.getId());
        verify(ledger).reverseWithdrawal(tx);
        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.FAILED);
        assertThat(tx.getFailureCode()).isEqualTo("CLEARING_DECLINED");
    }

    @Test
    void withdrawalNotSentRefundsAndFails() {
        FinancialTransaction tx = validated(TransactionType.WITHDRAWAL);
        when(clearing.authorize(any())).thenReturn(new ClearingResult.NotSent("circuit breaker open"));
        processor.process(tx.getId());
        verify(ledger).reverseWithdrawal(tx);
        assertThat(tx.getFailureCode()).isEqualTo("CLEARING_UNAVAILABLE");
    }

    @Test
    @DisplayName("an UNKNOWN outcome must NOT refund (money may have left) - it opens a reconciliation record")
    void withdrawalUnknownGoesToReconciliation() {
        FinancialTransaction tx = validated(TransactionType.WITHDRAWAL);
        when(clearing.authorize(any())).thenReturn(new ClearingResult.Unknown("read timeout"));
        processor.process(tx.getId());
        verify(ledger, never()).reverseWithdrawal(any());
        verify(reconciliation).open(tx, "CLEARING_OUTCOME_UNKNOWN", "read timeout");
        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.RECONCILIATION_REQUIRED);
    }

    @Test
    @DisplayName("redelivery of an event for an already processed or cancelled transaction does nothing")
    void nonValidatedTransactionIsSkipped() {
        FinancialTransaction tx = validated(TransactionType.WITHDRAWAL);
        tx.transitionTo(TransactionStatus.CANCELLED, NOW);
        processor.process(tx.getId());
        verifyNoInteractions(ledger, clearing, reconciliation);
        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.CANCELLED);
        processor.process(UUID.randomUUID()); // unknown id is also a no-op
    }

    @Test
    @DisplayName("a business failure from the ledger fails the transaction without calling the network")
    void ledgerBusinessFailureFailsTransaction() {
        FinancialTransaction first = validated(TransactionType.WITHDRAWAL);
        UUID id = first.getId();
        // the real database rolls the first attempt back, so the failure handler sees a fresh VALIDATED row
        FinancialTransaction fresh = new FinancialTransaction(id, "TXN-REF", TransactionType.WITHDRAWAL, first.getSourceAccountId(), null,
                new BigDecimal("25.0000"), "USD", null, "alice", NOW);
        fresh.transitionTo(TransactionStatus.VALIDATED, NOW);
        when(transactions.findById(id)).thenReturn(Optional.of(first), Optional.of(fresh));
        doThrow(ApiException.unprocessable("INSUFFICIENT_FUNDS", "Available balance is insufficient"))
                .when(ledger).reserveWithdrawal(first);

        processor.process(id);

        verifyNoInteractions(clearing);
        ArgumentCaptor<FinancialTransaction> saved = ArgumentCaptor.forClass(FinancialTransaction.class);
        verify(transactions).save(saved.capture());
        assertThat(saved.getValue().getStatus()).isEqualTo(TransactionStatus.FAILED);
        assertThat(saved.getValue().getFailureCode()).isEqualTo("INSUFFICIENT_FUNDS");
    }

    @Test
    @DisplayName("technical failures propagate (so the outbox retries) instead of failing the customer's transaction")
    void technicalFailuresPropagate() {
        FinancialTransaction tx = validated(TransactionType.DEPOSIT);
        doThrow(new org.springframework.dao.CannotAcquireLockException("lock timeout")).when(ledger).applyDeposit(tx);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> processor.process(tx.getId()))
                .isInstanceOf(org.springframework.dao.CannotAcquireLockException.class);
        verify(transactions, never()).save(any());
        verify(reconciliation, never()).open(any(), anyString(), anyString());
    }
}
