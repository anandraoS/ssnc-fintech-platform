package com.fintechdemo.platform.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Standard error envelope returned for every non-2xx response. */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ApiError(
        Instant timestamp,
        int status,
        String code,
        String message,
        String path,
        String correlationId,
        List<Violation> violations,
        Map<String, Object> details) {

    public record Violation(String field, String message) {
    }
}
