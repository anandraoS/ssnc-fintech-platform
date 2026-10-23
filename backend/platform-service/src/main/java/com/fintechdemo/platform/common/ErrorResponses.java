package com.fintechdemo.platform.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

/** Builds and writes {@link ApiError}s from places that sit outside Spring MVC (servlet filters, security handlers). */
public final class ErrorResponses {

    private ErrorResponses() {
    }

    public static ApiError build(HttpStatus status, String code, String message, String path,
                                 List<ApiError.Violation> violations, Map<String, Object> details) {
        return new ApiError(Instant.now(), status.value(), code, message, path,
                MDC.get(CorrelationIdFilter.MDC_KEY), violations, details);
    }

    public static void write(ObjectMapper mapper, HttpServletRequest request, HttpServletResponse response,
                             HttpStatus status, String code, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(response.getOutputStream(), build(status, code, message, request.getRequestURI(), null, null));
    }
}
