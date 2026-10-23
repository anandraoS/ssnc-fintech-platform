package com.fintechdemo.clearing;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Stand-in for an external payment-clearing network. It is deliberately UNRELIABLE on demand (deterministic triggers and
 * a chaos switch) so the platform's timeout, retry, circuit-breaker and reconciliation paths can be exercised.
 * It has no authentication and must only ever listen on localhost / a private test network.
 */
@SpringBootApplication
public class ClearingSimulatorApplication {

    public static void main(String[] args) {
        SpringApplication.run(ClearingSimulatorApplication.class, args);
    }
}
