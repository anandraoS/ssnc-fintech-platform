package com.fintechdemo.platform.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * One place that maps every failure to the standard {@link ApiError}. Messages for unexpected errors are generic:
 * stack traces, SQL and entity details never leave the server (OWASP A05/A09 - secure error handling).
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> handleApi(ApiException e, HttpServletRequest req) {
        return respond(e.getStatus(), e.getCode(), e.getMessage(), req, null, e.getDetails());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleBodyValidation(MethodArgumentNotValidException e, HttpServletRequest req) {
        List<ApiError.Violation> violations = e.getBindingResult().getAllErrors().stream()
                .map(err -> new ApiError.Violation(
                        err instanceof org.springframework.validation.FieldError fe ? fe.getField() : err.getObjectName(),
                        err.getDefaultMessage()))
                .toList();
        return respond(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Request validation failed", req, violations, null);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ApiError> handleConstraint(ConstraintViolationException e, HttpServletRequest req) {
        List<ApiError.Violation> violations = e.getConstraintViolations().stream()
                .map(v -> new ApiError.Violation(v.getPropertyPath().toString(), v.getMessage())).toList();
        return respond(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Request validation failed", req, violations, null);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadable(HttpMessageNotReadableException e, HttpServletRequest req) {
        if (e.getCause() instanceof RequestSizeLimitFilter.PayloadTooLargeException) {
            return respond(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "Request body too large", req, null, null);
        }
        // never echo the offending payload back
        return respond(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST", "Request body is missing or malformed", req, null, null);
    }

    @ExceptionHandler(RequestSizeLimitFilter.PayloadTooLargeException.class)
    ResponseEntity<ApiError> handleTooLarge(HttpServletRequest req) {
        return respond(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "Request body too large", req, null, null);
    }

    @ExceptionHandler({MissingRequestHeaderException.class, MissingServletRequestParameterException.class})
    ResponseEntity<ApiError> handleMissing(Exception e, HttpServletRequest req) {
        String name = e instanceof MissingRequestHeaderException h ? h.getHeaderName()
                : ((MissingServletRequestParameterException) e).getParameterName();
        String code = "Idempotency-Key".equalsIgnoreCase(name) ? "IDEMPOTENCY_KEY_REQUIRED" : "MISSING_PARAMETER";
        return respond(HttpStatus.BAD_REQUEST, code, "Required parameter or header is missing: " + name, req, null, null);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiError> handleTypeMismatch(MethodArgumentTypeMismatchException e, HttpServletRequest req) {
        return respond(HttpStatus.BAD_REQUEST, "INVALID_PARAMETER", "Invalid value for parameter: " + e.getName(), req, null, null);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiError> handleMethod(HttpRequestMethodNotSupportedException e, HttpServletRequest req) {
        return respond(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "HTTP method not supported for this resource", req, null, null);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiError> handleMedia(HttpMediaTypeNotSupportedException e, HttpServletRequest req) {
        return respond(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "Content type not supported", req, null, null);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> handleNoResource(NoResourceFoundException e, HttpServletRequest req) {
        return respond(HttpStatus.NOT_FOUND, "NOT_FOUND", "Resource not found", req, null, null);
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiError> handleDenied(AccessDeniedException e, HttpServletRequest req) {
        return respond(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "You do not have permission to perform this operation", req, null, null);
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    ResponseEntity<ApiError> handleOptimistic(OptimisticLockingFailureException e, HttpServletRequest req) {
        log.warn("Optimistic lock conflict on {} {}: {}", req.getMethod(), req.getRequestURI(), e.getMessage());
        return respond(HttpStatus.CONFLICT, "CONCURRENT_MODIFICATION",
                "The resource was modified concurrently; re-read it and retry", req, null, null);
    }

    @ExceptionHandler(PessimisticLockingFailureException.class)
    ResponseEntity<ApiError> handleLock(PessimisticLockingFailureException e, HttpServletRequest req) {
        log.warn("Lock acquisition failed: {}", e.getClass().getSimpleName());
        ResponseEntity<ApiError> r = respond(HttpStatus.SERVICE_UNAVAILABLE, "LOCK_TIMEOUT",
                "The resource is busy; retry shortly", req, null, null);
        return ResponseEntity.status(r.getStatusCode()).header(HttpHeaders.RETRY_AFTER, "1").body(r.getBody());
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiError> handleIntegrity(DataIntegrityViolationException e, HttpServletRequest req) {
        log.warn("Data integrity violation: {}", e.getMostSpecificCause().getClass().getSimpleName());
        return respond(HttpStatus.CONFLICT, "CONFLICT", "The request conflicts with the current state of the resource", req, null, null);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception e, HttpServletRequest req) {
        log.error("Unhandled exception on {} {}", req.getMethod(), req.getRequestURI(), e);
        return respond(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "An unexpected error occurred. Quote the correlation id when contacting support.", req, null, null);
    }

    private ResponseEntity<ApiError> respond(HttpStatus status, String code, String message, HttpServletRequest req,
                                             List<ApiError.Violation> violations, Map<String, Object> details) {
        return ResponseEntity.status(status)
                .body(ErrorResponses.build(status, code, message, req.getRequestURI(), violations, details));
    }
}
