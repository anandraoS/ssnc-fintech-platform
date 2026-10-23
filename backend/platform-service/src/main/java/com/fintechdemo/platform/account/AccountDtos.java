package com.fintechdemo.platform.account;

import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Public API contract for accounts. Money is serialized as a JSON STRING so that JavaScript clients never route
 * monetary values through IEEE-754 doubles.
 */
public final class AccountDtos {

    private AccountDtos() {
    }

    public record OpenAccountRequest(
            @NotNull AccountType accountType,
            @NotBlank @Pattern(regexp = "^[A-Z]{3}$", message = "must be a 3-letter ISO currency code") String currency,
            @DecimalMin(value = "0.00", message = "must not be negative") @Digits(integer = 15, fraction = 2) BigDecimal dailyWithdrawalLimit) {
    }

    public record SuspendAccountRequest(@NotBlank @Size(max = 255) String reason) {
    }

    public record AccountResponse(
            UUID id,
            String accountNumber,
            UUID customerId,
            AccountType accountType,
            AccountStatus status,
            String statusReason,
            String currency,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal balance,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal availableBalance,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal minimumBalance,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal dailyWithdrawalLimit,
            long version,
            Instant openedAt,
            Instant updatedAt) {
    }

    public record BalanceResponse(
            UUID accountId,
            String currency,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal ledgerBalance,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal minimumBalance,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal availableBalance,
            Instant asOf) {
    }
}
