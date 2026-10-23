package com.fintechdemo.platform.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Replaces the clearing adapter (in-process or REST) with the scripted double for every integration test. */
@TestConfiguration
public class TestClearingConfig {

    @Bean
    @Primary
    ScriptedClearingClient scriptedClearingClient() {
        return new ScriptedClearingClient();
    }
}
