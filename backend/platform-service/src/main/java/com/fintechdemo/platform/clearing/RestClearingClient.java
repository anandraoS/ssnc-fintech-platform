package com.fintechdemo.platform.clearing;

import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.util.Map;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * REST adapter to the clearing network with: connect/read timeouts, retry with exponential backoff + jitter
 * (safe because the remote operation is idempotent on {@code reference}) and a circuit breaker.
 * Outcome mapping is deliberately conservative - see {@link ClearingClient.ClearingResult}:
 * connection refused => NotSent (refund immediately); timeout or 5xx after retries => Unknown (reconcile).
 */
public class RestClearingClient implements ClearingClient {

    private static final Logger log = LoggerFactory.getLogger(RestClearingClient.class);

    /** Transport-level failure; {@code mayHaveReachedServer} decides NotSent vs Unknown. */
    static final class ClearingTransportException extends RuntimeException {
        private final boolean mayHaveReachedServer;

        ClearingTransportException(String message, boolean mayHaveReachedServer, Throwable cause) {
            super(message, cause);
            this.mayHaveReachedServer = mayHaveReachedServer;
        }

        boolean mayHaveReachedServer() {
            return mayHaveReachedServer;
        }
    }

    private static final class NotFoundSignal extends RuntimeException {
        NotFoundSignal() {
            super("not found", null, false, false);
        }
    }

    private final RestClient http;
    private final RetryExecutor retry;
    private final CircuitBreaker circuit;

    public RestClearingClient(RestClient http, RetryExecutor retry, CircuitBreaker circuit) {
        this.http = http;
        this.retry = retry;
        this.circuit = circuit;
    }

    @Override
    public ClearingResult authorize(ClearingRequest request) {
        try {
            Map<?, ?> body = circuit.executeSupplier(() -> retry.execute(() -> translated(() -> http.post()
                            .uri("/clearing/v1/authorizations")
                            .contentType(MediaType.APPLICATION_JSON)
                            .body(Map.of("reference", request.reference(), "amount", request.amount().toPlainString(),
                                    "currency", request.currency()))
                            .retrieve().body(Map.class)),
                    t -> t instanceof ClearingTransportException));
            return map(body);
        } catch (CallNotPermittedException e) {
            return new ClearingResult.NotSent("circuit breaker open");
        } catch (ClearingTransportException e) {
            log.warn("Clearing authorize failed for {}: {}", request.reference(), e.getMessage());
            return e.mayHaveReachedServer() ? new ClearingResult.Unknown(e.getMessage()) : new ClearingResult.NotSent(e.getMessage());
        } catch (RestClientResponseException e) {
            // 4xx: the network understood and refused the request itself - nothing was executed
            return new ClearingResult.NotSent("clearing rejected the request: HTTP " + e.getStatusCode().value());
        } catch (RuntimeException e) {
            log.warn("Unexpected clearing error for {}: {}", request.reference(), e.toString());
            return new ClearingResult.Unknown("unexpected error: " + e.getClass().getSimpleName());
        }
    }

    @Override
    public ClearingResult lookup(String reference) {
        try {
            Map<?, ?> body = circuit.executeSupplier(() -> translated(() -> http.get()
                    .uri("/clearing/v1/authorizations/{ref}", reference)
                    .retrieve()
                    .onStatus(status -> status.value() == 404, (req, res) -> {
                        throw new NotFoundSignal();
                    })
                    .body(Map.class)));
            return map(body);
        } catch (NotFoundSignal e) {
            return new ClearingResult.NotFound();
        } catch (CallNotPermittedException e) {
            return new ClearingResult.Unknown("circuit breaker open");
        } catch (RuntimeException e) {
            return new ClearingResult.Unknown("lookup failed: " + e.getClass().getSimpleName());
        }
    }

    @Override
    public boolean isHealthy() {
        try {
            http.get().uri("/actuator/health/liveness").retrieve().toBodilessEntity();
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    @Override
    public String circuitState() {
        return circuit.getState().name();
    }

    private ClearingResult map(Map<?, ?> body) {
        if (body == null) {
            return new ClearingResult.Unknown("empty response from clearing");
        }
        Object status = body.get("status");
        if ("AUTHORIZED".equals(status)) {
            return new ClearingResult.Authorized(String.valueOf(body.get("authorizationId")));
        }
        if ("DECLINED".equals(status)) {
            Object reason = body.get("reasonCode");
            return new ClearingResult.Declined(reason == null ? "DECLINED" : String.valueOf(reason));
        }
        return new ClearingResult.Unknown("unrecognised clearing status");
    }

    /** Converts Spring client failures into transport exceptions that record "did the request reach the server?". */
    private static <T> T translated(Supplier<T> call) {
        try {
            return call.get();
        } catch (ResourceAccessException e) {
            throw classify(e);
        } catch (HttpServerErrorException e) {
            throw new ClearingTransportException("clearing returned HTTP " + e.getStatusCode().value(), true, e);
        }
    }

    static ClearingTransportException classify(Throwable t) {
        Throwable root = t;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        // failures that happen BEFORE any byte of the request could have been delivered: safe to treat as "not sent"
        if (root instanceof ConnectException || root instanceof HttpConnectTimeoutException
                || root instanceof java.net.UnknownHostException || root instanceof java.net.NoRouteToHostException
                || root instanceof java.nio.channels.UnresolvedAddressException) {
            return new ClearingTransportException("connection failed: " + root.getClass().getSimpleName(), false, t);
        }
        if (root instanceof SocketTimeoutException || root instanceof HttpTimeoutException) {
            return new ClearingTransportException("read timeout", true, t);
        }
        return new ClearingTransportException("transport error: " + root.getClass().getSimpleName(), true, t);
    }
}
