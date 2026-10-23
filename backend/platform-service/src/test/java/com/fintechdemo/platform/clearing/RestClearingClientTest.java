package com.fintechdemo.platform.clearing;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.clearing.ClearingClient.ClearingRequest;
import com.fintechdemo.platform.clearing.ClearingClient.ClearingResult;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Exercises the REAL HTTP adapter (timeouts, retry, circuit breaker, outcome mapping) against an in-JVM HTTP server -
 * no mocks of the HTTP layer, so what is tested is what runs.
 */
class RestClearingClientTest {

    private HttpServer server;
    private final AtomicInteger hits = new AtomicInteger();
    private final AtomicInteger sleeps = new AtomicInteger();
    private final java.util.List<String> requests = new java.util.concurrent.CopyOnWriteArrayList<>();
    private volatile Handler handler;

    @FunctionalInterface
    interface Handler {
        void handle(HttpExchange exchange, int hit) throws Exception;
    }

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            int hit = hits.incrementAndGet();
            requests.add(exchange.getRequestMethod() + " " + exchange.getRequestURI() + " " + exchange.getRequestHeaders().keySet());
            try {
                handler.handle(exchange, hit);
            } catch (Exception e) {
                // simulate a dropped connection
                exchange.close();
            }
        });
        server.start();
        // warm up class loading on both sides so the first test is not hit by a cold-start read timeout
        handler = (ex, hit) -> reply(ex, 200, "{}");
        RestClearingClient warm = client();
        warm.isHealthy();
        warm.authorize(REQ);
        hits.set(0);
        sleeps.set(0);
        requests.clear();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private static int freePort() throws IOException {
        try (java.net.ServerSocket socket = new java.net.ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static void reply(HttpExchange ex, int status, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(status, body.length == 0 ? -1 : body.length);
        if (body.length > 0) {
            ex.getResponseBody().write(body);
        }
        ex.close();
    }

    private RestClearingClient client(String baseUrl, int failureWindow) {
        HttpClient jdk = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofMillis(300)).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(jdk);
        factory.setReadTimeout(Duration.ofMillis(400));
        RestClient rest = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
        RetryExecutor retry = new RetryExecutor(3, Duration.ofMillis(1), Duration.ofMillis(3), new Random(3), d -> sleeps.incrementAndGet());
        CircuitBreaker breaker = CircuitBreaker.of("t" + System.nanoTime(), CircuitBreakerConfig.custom()
                .failureRateThreshold(50).minimumNumberOfCalls(failureWindow).slidingWindowSize(failureWindow)
                .waitDurationInOpenState(Duration.ofMinutes(5))
                .recordExceptions(RestClearingClient.ClearingTransportException.class).build());
        return new RestClearingClient(rest, retry, breaker);
    }

    private RestClearingClient client() {
        return client("http://127.0.0.1:" + server.getAddress().getPort(), 100);
    }

    private static final ClearingRequest REQ = new ClearingRequest("TXN-1", new BigDecimal("10.00"), "USD");

    @Test
    @DisplayName("authorized response maps to Authorized")
    void authorized() {
        handler = (ex, hit) -> reply(ex, 200, "{\"status\":\"AUTHORIZED\",\"authorizationId\":\"AUTH-1\"}");
        assertThat(client().authorize(REQ)).isEqualTo(new ClearingResult.Authorized("AUTH-1"));
        assertThat(hits).as(requests + " retrySleeps=" + sleeps).hasValue(1);
    }

    @Test
    @DisplayName("a definitive decline maps to Declined and is not retried")
    void declined() {
        handler = (ex, hit) -> reply(ex, 200, "{\"status\":\"DECLINED\",\"reasonCode\":\"RISK_DECLINE\"}");
        assertThat(client().authorize(REQ)).isEqualTo(new ClearingResult.Declined("RISK_DECLINE"));
        assertThat(hits).hasValue(1);
    }

    @Test
    @DisplayName("transient 503s are retried and the eventual success is returned")
    void retriesTransientFailures() {
        handler = (ex, hit) -> {
            if (hit < 3) {
                reply(ex, 503, "{\"error\":\"busy\"}");
            } else {
                reply(ex, 200, "{\"status\":\"AUTHORIZED\",\"authorizationId\":\"AUTH-9\"}");
            }
        };
        assertThat(client().authorize(REQ)).isEqualTo(new ClearingResult.Authorized("AUTH-9"));
        assertThat(hits).hasValue(3);
    }

    @Test
    @DisplayName("persistent 5xx after all retries is UNKNOWN (the server may have executed it) - never 'failed'")
    void persistent5xxIsUnknown() {
        handler = (ex, hit) -> reply(ex, 503, "{}");
        assertThat(client().authorize(REQ)).isInstanceOf(ClearingResult.Unknown.class);
        assertThat(hits).hasValue(3);
    }

    @Test
    @DisplayName("a read timeout is UNKNOWN, not a failure")
    void readTimeoutIsUnknown() {
        handler = (ex, hit) -> {
            Thread.sleep(1200);
            reply(ex, 200, "{\"status\":\"AUTHORIZED\",\"authorizationId\":\"LATE\"}");
        };
        ClearingResult r = client().authorize(REQ);
        assertThat(r).isInstanceOf(ClearingResult.Unknown.class);
        assertThat(((ClearingResult.Unknown) r).detail()).contains("timeout");
    }

    @Test
    @DisplayName("a host that cannot be resolved is NOT_SENT - nothing could have reached the network")
    void unresolvableHostIsNotSent() {
        ClearingResult r = client("http://clearing.invalid:9", 100).authorize(REQ);
        assertThat(r).isInstanceOf(ClearingResult.NotSent.class);
    }

    @Test
    @DisplayName("pre-delivery failures are classified NotSent, ambiguous ones Unknown")
    void classification() {
        assertThat(RestClearingClient.classify(new java.net.ConnectException("refused")).mayHaveReachedServer()).isFalse();
        assertThat(RestClearingClient.classify(new RuntimeException(new java.net.http.HttpConnectTimeoutException("t"))).mayHaveReachedServer()).isFalse();
        assertThat(RestClearingClient.classify(new java.net.SocketTimeoutException("read")).mayHaveReachedServer()).isTrue();
        assertThat(RestClearingClient.classify(new java.nio.channels.ClosedChannelException()).mayHaveReachedServer()).isTrue();
    }

    @Test
    @DisplayName("a 4xx means the request itself was refused: nothing was executed")
    void clientErrorIsNotSent() {
        handler = (ex, hit) -> reply(ex, 400, "{}");
        assertThat(client().authorize(REQ)).isInstanceOf(ClearingResult.NotSent.class);
        assertThat(hits).hasValue(1);
    }

    @Test
    @DisplayName("circuit breaker opens after repeated failures and then short-circuits without calling the server")
    void circuitBreakerOpens() {
        handler = (ex, hit) -> reply(ex, 503, "{}");
        RestClearingClient c = client("http://127.0.0.1:" + server.getAddress().getPort(), 2);
        assertThat(c.authorize(REQ)).isInstanceOf(ClearingResult.Unknown.class);
        assertThat(c.authorize(REQ)).isInstanceOf(ClearingResult.Unknown.class);
        assertThat(c.circuitState()).isEqualTo("OPEN");
        int before = hits.get();
        ClearingResult r = c.authorize(REQ);
        assertThat(r).isEqualTo(new ClearingResult.NotSent("circuit breaker open"));
        assertThat(hits).hasValue(before); // no request reached the server
    }

    @Test
    @DisplayName("lookup maps 200 to the recorded result and 404 to NotFound")
    void lookup() {
        handler = (ex, hit) -> {
            if (ex.getRequestURI().getPath().endsWith("/KNOWN")) {
                reply(ex, 200, "{\"status\":\"AUTHORIZED\",\"authorizationId\":\"AUTH-K\"}");
            } else {
                reply(ex, 404, "");
            }
        };
        RestClearingClient c = client();
        assertThat(c.lookup("KNOWN")).isEqualTo(new ClearingResult.Authorized("AUTH-K"));
        assertThat(c.lookup("MISSING")).isInstanceOf(ClearingResult.NotFound.class);
    }

    @Test
    void healthCheckReflectsReachability() throws IOException {
        handler = (ex, hit) -> reply(ex, 200, "{\"status\":\"UP\"}");
        assertThat(client().isHealthy()).isTrue();
        assertThat(client("http://127.0.0.1:" + freePort(), 10).isHealthy()).isFalse();
    }
}
