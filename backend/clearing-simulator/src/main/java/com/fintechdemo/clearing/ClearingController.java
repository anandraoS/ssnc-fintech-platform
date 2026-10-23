package com.fintechdemo.clearing;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Deterministic behaviours (decided by the cents of the amount) make end-to-end scenarios repeatable:
 * <ul>
 *   <li>cents .13 - DECLINED (RISK_DECLINE)</li>
 *   <li>cents .66 - the authorization IS recorded but the response is delayed past the client's read timeout
 *       (the classic "did it happen?" problem - resolved later through lookup/reconciliation)</li>
 *   <li>cents .99 - HTTP 503 for the first two attempts per reference, then success (exercises retry)</li>
 *   <li>anything else - AUTHORIZED</li>
 * </ul>
 * The chaos switch overrides this for every request: FAIL_5XX, SLOW (adds delayMs) or NORMAL.
 */
@RestController
public class ClearingController {

    public enum Mode {NORMAL, FAIL_5XX, SLOW}

    public record AuthorizeRequest(@NotBlank String reference,
                                   @NotNull @Pattern(regexp = "^[0-9]+(\\.[0-9]{1,4})?$") String amount,
                                   @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency) {
    }

    public record ChaosRequest(@NotNull Mode mode, Long delayMs) {
    }

    private record Authorization(String status, String authorizationId, String reasonCode) {
    }

    private final Map<String, Authorization> store = new ConcurrentHashMap<>();
    private final Map<String, AtomicInteger> attemptsByReference = new ConcurrentHashMap<>();
    private volatile Mode mode = Mode.NORMAL;
    private volatile long delayMs = 3000;

    @PostMapping("/clearing/v1/authorizations")
    public ResponseEntity<Map<String, Object>> authorize(@Valid @RequestBody AuthorizeRequest request) throws InterruptedException {
        if (mode == Mode.FAIL_5XX) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "chaos: unavailable"));
        }
        if (mode == Mode.SLOW) {
            Thread.sleep(delayMs);
        }
        int cents = new BigDecimal(request.amount()).remainder(BigDecimal.ONE).movePointRight(2).intValue();
        int attempt = attemptsByReference.computeIfAbsent(request.reference(), r -> new AtomicInteger()).incrementAndGet();

        if (cents == 99 && attempt <= 2 && !store.containsKey(request.reference())) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "transient failure, attempt " + attempt));
        }
        Authorization result = store.computeIfAbsent(request.reference(), r -> cents == 13
                ? new Authorization("DECLINED", null, "RISK_DECLINE")
                : new Authorization("AUTHORIZED", "AUTH-" + r, null));
        if (cents == 66) {
            Thread.sleep(8000); // recorded, but the caller will have timed out by now
        }
        return ResponseEntity.ok(view(result));
    }

    @GetMapping("/clearing/v1/authorizations/{reference}")
    public ResponseEntity<Map<String, Object>> lookup(@PathVariable String reference) {
        Authorization found = store.get(reference);
        return found == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(view(found));
    }

    @PostMapping("/simulator/chaos")
    public Map<String, Object> chaos(@Valid @RequestBody ChaosRequest request) {
        this.mode = request.mode();
        if (request.delayMs() != null) {
            this.delayMs = Math.max(0, Math.min(request.delayMs(), 30_000));
        }
        return Map.of("mode", mode, "delayMs", delayMs);
    }

    @PostMapping("/simulator/reset")
    public Map<String, Object> reset() {
        store.clear();
        attemptsByReference.clear();
        mode = Mode.NORMAL;
        return Map.of("mode", mode, "authorizations", 0);
    }

    @GetMapping("/simulator/state")
    public Map<String, Object> state() {
        return Map.of("mode", mode, "delayMs", delayMs, "authorizations", store.size());
    }

    private static Map<String, Object> view(Authorization a) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("status", a.status());
        if (a.authorizationId() != null) {
            m.put("authorizationId", a.authorizationId());
        }
        if (a.reasonCode() != null) {
            m.put("reasonCode", a.reasonCode());
        }
        return m;
    }
}
