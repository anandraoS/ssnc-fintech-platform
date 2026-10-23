package com.fintechdemo.platform.clearing;

import java.math.BigDecimal;

/**
 * Port to the external payment-clearing network. The three-way distinction between "declined", "never sent" and
 * "outcome unknown" is the heart of safe integration with a system we cannot enlist in our database transaction:
 * only a DEFINITE outcome may change money state; UNKNOWN must go to reconciliation.
 */
public interface ClearingClient {

    record ClearingRequest(String reference, BigDecimal amount, String currency) {
    }

    sealed interface ClearingResult {
        /** The network accepted the payout. */
        record Authorized(String authorizationId) implements ClearingResult {
        }

        /** The network definitively refused it. */
        record Declined(String reasonCode) implements ClearingResult {
        }

        /** Lookup only: the network has no record of this reference. */
        record NotFound() implements ClearingResult {
        }

        /** The request provably never reached the network (connection refused, circuit open): safe to fail and refund. */
        record NotSent(String detail) implements ClearingResult {
        }

        /** The request may or may not have been executed (timeout, 5xx after retries): must be reconciled. */
        record Unknown(String detail) implements ClearingResult {
        }
    }

    /** Idempotent on {@code reference}: repeating the call can never authorize twice. */
    ClearingResult authorize(ClearingRequest request);

    /** Asks the network what happened to a previous authorization. */
    ClearingResult lookup(String reference);

    boolean isHealthy();

    String circuitState();
}
