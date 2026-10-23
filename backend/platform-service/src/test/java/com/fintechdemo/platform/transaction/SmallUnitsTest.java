package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.ops.OpsServiceTestAccess;
import com.fintechdemo.platform.transaction.TransactionDtos.SubmitTransactionRequest;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SmallUnitsTest {

    @Test
    @DisplayName("idempotency fingerprint: equal payloads match (scale-insensitive), any difference changes the hash")
    void fingerprint() {
        UUID target = UUID.randomUUID();
        SubmitTransactionRequest base = new SubmitTransactionRequest(TransactionType.DEPOSIT, null, target, new BigDecimal("10.00"), "USD", "rent");
        SubmitTransactionRequest sameValueOtherScale = new SubmitTransactionRequest(TransactionType.DEPOSIT, null, target, new BigDecimal("10"), "USD", "rent");
        assertThat(TransactionService.fingerprint(sameValueOtherScale)).isEqualTo(TransactionService.fingerprint(base));
        assertThat(TransactionService.fingerprint(new SubmitTransactionRequest(TransactionType.DEPOSIT, null, target, new BigDecimal("10.01"), "USD", "rent")))
                .isNotEqualTo(TransactionService.fingerprint(base));
        assertThat(TransactionService.fingerprint(new SubmitTransactionRequest(TransactionType.DEPOSIT, null, target, new BigDecimal("10.00"), "EUR", "rent")))
                .isNotEqualTo(TransactionService.fingerprint(base));
        assertThat(TransactionService.fingerprint(new SubmitTransactionRequest(TransactionType.DEPOSIT, null, UUID.randomUUID(), new BigDecimal("10.00"), "USD", "rent")))
                .isNotEqualTo(TransactionService.fingerprint(base));
        assertThat(TransactionService.fingerprint(base)).hasSize(64).matches("[0-9a-f]+");
    }

    @Test
    @DisplayName("request DTO rejects accounts that do not fit the transaction type")
    void requestConsistency() {
        UUID a = UUID.randomUUID();
        BigDecimal amt = BigDecimal.ONE;
        assertThat(new SubmitTransactionRequest(TransactionType.DEPOSIT, null, a, amt, "USD", null).isAccountsConsistentWithType()).isTrue();
        assertThat(new SubmitTransactionRequest(TransactionType.DEPOSIT, a, a, amt, "USD", null).isAccountsConsistentWithType()).isFalse();
        assertThat(new SubmitTransactionRequest(TransactionType.WITHDRAWAL, a, null, amt, "USD", null).isAccountsConsistentWithType()).isTrue();
        assertThat(new SubmitTransactionRequest(TransactionType.WITHDRAWAL, null, a, amt, "USD", null).isAccountsConsistentWithType()).isFalse();
        assertThat(new SubmitTransactionRequest(TransactionType.TRANSFER, a, UUID.randomUUID(), amt, "USD", null).isAccountsConsistentWithType()).isTrue();
        assertThat(new SubmitTransactionRequest(TransactionType.TRANSFER, a, null, amt, "USD", null).isAccountsConsistentWithType()).isFalse();
    }

    @Test
    @DisplayName("nearest-rank percentiles for the latency widget")
    void percentiles() {
        List<Long> sorted = java.util.stream.LongStream.rangeClosed(1, 100).boxed().toList();
        assertThat(OpsServiceTestAccess.percentile(sorted, 50)).isEqualTo(50);
        assertThat(OpsServiceTestAccess.percentile(sorted, 95)).isEqualTo(95);
        assertThat(OpsServiceTestAccess.percentile(sorted, 99)).isEqualTo(99);
        assertThat(OpsServiceTestAccess.percentile(List.of(7L), 99)).isEqualTo(7);
    }
}
