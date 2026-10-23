package com.fintechdemo.platform.clearing;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Local substitute used when no {@code app.clearing.base-url} is configured: approves everything and remembers the
 * result per reference (so repeated calls stay idempotent). It exists so the platform runs stand-alone; it does NOT
 * exercise timeouts, retries or the circuit breaker - run the clearing-simulator for that.
 */
public class InProcessClearingClient implements ClearingClient {

    private final Map<String, ClearingResult> authorizations = new ConcurrentHashMap<>();

    @Override
    public ClearingResult authorize(ClearingRequest request) {
        return authorizations.computeIfAbsent(request.reference(), r -> new ClearingResult.Authorized("LOCAL-" + r));
    }

    @Override
    public ClearingResult lookup(String reference) {
        ClearingResult known = authorizations.get(reference);
        return known != null ? known : new ClearingResult.NotFound();
    }

    @Override
    public boolean isHealthy() {
        return true;
    }

    @Override
    public String circuitState() {
        return "NOT_APPLICABLE";
    }
}
