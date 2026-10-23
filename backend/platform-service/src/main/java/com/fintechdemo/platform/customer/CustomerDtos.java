package com.fintechdemo.platform.customer;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

/** Public API contract for customers. Entities are never exposed. */
public final class CustomerDtos {

    private CustomerDtos() {
    }

    public record CreateCustomerRequest(
            @NotBlank @Size(max = 200) String legalName,
            @NotBlank @Email @Size(max = 254) String email,
            @Size(max = 32) @Pattern(regexp = "^[+0-9()\\- ]*$", message = "must contain only digits, spaces and + ( ) -") String phone,
            @Pattern(regexp = "^[0-9]{4}$", message = "must be exactly 4 digits") String taxIdLast4) {
    }

    public record UpdateCustomerRequest(
            @Size(min = 1, max = 200) String legalName,
            @Email @Size(max = 254) String email,
            @Size(max = 32) @Pattern(regexp = "^[+0-9()\\- ]*$", message = "must contain only digits, spaces and + ( ) -") String phone) {
    }

    public record ChangeStatusRequest(@NotBlank @Size(max = 255) String reason) {
    }

    public record CustomerResponse(
            UUID id,
            String customerRef,
            String legalName,
            String email,
            String phone,
            String taxIdLast4,
            CustomerStatus status,
            long version,
            Instant createdAt,
            Instant updatedAt) {
    }
}
