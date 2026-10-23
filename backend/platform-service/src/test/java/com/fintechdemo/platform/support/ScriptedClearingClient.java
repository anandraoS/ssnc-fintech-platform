package com.fintechdemo.platform.support;

import com.fintechdemo.platform.clearing.ClearingClient;
import java.math.BigDecimal;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Test double for the clearing network, scripted by the CENTS of the amount (same convention as the simulator):
 * .13 declined | .66 timeout but the network DID execute (lookup: authorized) | .77 timeout and NOT executed
 * (lookup: not found) | .88 never sent | anything else authorized.
 */
public class ScriptedClearingClient implements ClearingClient {

    private final Map<String, ClearingResult> network = new ConcurrentHashMap<>();
    private final AtomicInteger calls = new AtomicInteger();

    @Override
    public ClearingResult authorize(ClearingRequest request) {
        calls.incrementAndGet();
        int cents = request.amount().remainder(BigDecimal.ONE).movePointRight(2).intValue();
        return switch (cents) {
            case 13 -> new ClearingResult.Declined("RISK_DECLINE");
            case 66 -> {
                network.put(request.reference(), new ClearingResult.Authorized("AUTH-" + request.reference()));
                yield new ClearingResult.Unknown("read timeout");
            }
            case 77 -> new ClearingResult.Unknown("read timeout");
            case 88 -> new ClearingResult.NotSent("connection refused");
            default -> {
                ClearingResult ok = new ClearingResult.Authorized("AUTH-" + request.reference());
                network.put(request.reference(), ok);
                yield ok;
            }
        };
    }

    @Override
    public ClearingResult lookup(String reference) {
        ClearingResult known = network.get(reference);
        return known != null ? known : new ClearingResult.NotFound();
    }

    @Override
    public boolean isHealthy() {
        return true;
    }

    @Override
    public String circuitState() {
        return "CLOSED";
    }

    public int calls() {
        return calls.get();
    }
}
