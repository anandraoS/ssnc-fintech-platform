package com.fintechdemo.platform.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fintechdemo.platform.common.ErrorResponses;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Per-caller rate limiting (OWASP API4). Authenticated calls are keyed by subject, anonymous ones (login) by remote
 * address, and the login endpoint has a much stricter bucket to slow credential stuffing. Registered inside the
 * security chain (not as a stand-alone servlet filter bean) so the subject is already known.
 * Behind a proxy, configure forwarded-header handling so the remote address is the client's, not the proxy's.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private final TokenBucketRateLimiter limiter;
    private final SecurityProperties.RateLimit config;
    private final ObjectMapper mapper;

    public RateLimitFilter(TokenBucketRateLimiter limiter, SecurityProperties.RateLimit config, ObjectMapper mapper) {
        this.limiter = limiter;
        this.config = config;
        this.mapper = mapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !config.enabled() || !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        boolean login = request.getRequestURI().startsWith("/api/v1/auth/");
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String subject = auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getName()) ? auth.getName() : null;
        TokenBucketRateLimiter.Decision decision = login
                ? limiter.tryAcquire("auth:" + request.getRemoteAddr(), config.authCapacity(), config.authRefillPerMinute())
                : limiter.tryAcquire("api:" + (subject != null ? subject : request.getRemoteAddr()), config.apiCapacity(),
                config.apiRefillPerMinute());
        if (!decision.allowed()) {
            response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(decision.retryAfterSeconds()));
            ErrorResponses.write(mapper, request, response, HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED",
                    "Too many requests; retry after " + decision.retryAfterSeconds() + "s");
            return;
        }
        chain.doFilter(request, response);
    }
}
