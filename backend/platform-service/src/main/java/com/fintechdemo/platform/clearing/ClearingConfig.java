package com.fintechdemo.platform.clearing;

import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import java.net.http.HttpClient;
import java.util.random.RandomGenerator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class ClearingConfig {

    @Bean
    ClearingClient clearingClient(ClearingProperties props, RestClient.Builder restClientBuilder) {
        if (!props.configured()) {
            return new InProcessClearingClient();
        }
        HttpClient jdk = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(props.connectTimeout()).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(jdk);
        factory.setReadTimeout(props.readTimeout());
        // the Boot-managed builder carries the observation customizer, so every call shows up in traces and http.client.requests
        RestClient rest = restClientBuilder.baseUrl(props.baseUrl()).requestFactory(factory).build();
        RetryExecutor retry = new RetryExecutor(props.maxAttempts(), props.retryBaseDelay(), props.retryMaxDelay(),
                new java.util.Random(), d -> Thread.sleep(d.toMillis()));
        CircuitBreaker breaker = CircuitBreaker.of("clearing", CircuitBreakerConfig.custom()
                .failureRateThreshold(props.circuitFailureRate())
                .minimumNumberOfCalls(props.circuitMinimumCalls())
                .slidingWindowSize(props.circuitWindow())
                .waitDurationInOpenState(props.circuitOpenDuration())
                .recordExceptions(RestClearingClient.ClearingTransportException.class)
                .build());
        return new RestClearingClient(rest, retry, breaker);
    }
}
