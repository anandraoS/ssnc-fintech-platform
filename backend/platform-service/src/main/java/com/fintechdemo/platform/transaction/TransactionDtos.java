package com.fintechdemo.platform.transaction;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Public API contract for transactions. Amounts travel as JSON strings (no floating-point in clients). */
public final class TransactionDtos {

    private TransactionDtos() {
    }

    public record SubmitTransactionRequest(
            @NotNull TransactionType type,
            UUID sourceAccountId,
            UUID targetAccountId,
            @NotNull @DecimalMin(value = "0.0001", message = "must be greater than zero")
            @Digits(integer = 15, fraction = 4, message = "at most 15 integer and 4 fraction digits") BigDecimal amount,
            @NotBlank @Pattern(regexp = "^[A-Z]{3}$", message = "must be a 3-letter ISO currency code") String currency,
            @Size(max = 140) @Pattern(regexp = "^[\\p{L}\\p{N} .,:;'()/#_-]*$", message = "contains unsupported characters") String memo) {

        @JsonIgnore
        @AssertTrue(message = "accounts do not match the transaction type "
                + "(DEPOSIT: target only, WITHDRAWAL: source only, TRANSFER: both)")
        public boolean isAccountsConsistentWithType() {
            if (type == null) {
                return true; // reported by @NotNull
            }
            return switch (type) {
                case DEPOSIT -> targetAccountId != null && sourceAccountId == null;
                case WITHDRAWAL -> sourceAccountId != null && targetAccountId == null;
                case TRANSFER -> sourceAccountId != null && targetAccountId != null;
            };
        }
    }

    public record RejectRequest(@NotBlank @Size(max = 255) String reason) {
    }

    public record ApproveRequest(@Size(max = 255) String note) {
    }

    public record TransactionResponse(
            UUID id,
            String reference,
            TransactionType type,
            TransactionStatus status,
            UUID sourceAccountId,
            UUID targetAccountId,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal amount,
            String currency,
            String memo,
            String submittedBy,
            String reviewedBy,
            String failureCode,
            String failureDetail,
            long version,
            Instant createdAt,
            Instant updatedAt,
            Instant completedAt) {
    }

    public record AttemptResponse(int attemptNo, String stage, String outcome, String detail, Instant startedAt,
                                  Instant finishedAt) {
    }

    public record SubmitResult(TransactionResponse transaction, boolean replayed) {
    }
}
