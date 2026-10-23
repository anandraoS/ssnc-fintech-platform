package com.fintechdemo.platform.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fintechdemo.platform.common.ErrorResponses;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Security architecture: stateless OAuth 2.0 resource server validating JWT bearer tokens (signature, expiry, issuer),
 * role-based endpoint rules (@PreAuthorize) plus object-level checks in AccessPolicy, deny-by-default for anything not
 * explicitly listed, secure headers, strict CORS and request throttling.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, SecurityProperties props, ObjectMapper mapper,
                                            @Value("${app.docs.public:false}") boolean docsPublic) throws Exception {
        RateLimitFilter rateLimit = new RateLimitFilter(new TokenBucketRateLimiter(), props.rateLimit(), mapper);

        http
                // CSRF protection defends cookie-based sessions. This API is stateless and authenticates with an
                // Authorization header that browsers never attach automatically, so CSRF does not apply. If cookies
                // were ever introduced (e.g. a BFF), this MUST be re-enabled.
                .csrf(AbstractHttpConfigurer::disable)
                .cors(c -> c.configurationSource(corsSource(props)))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .headers(h -> {
                    h.contentTypeOptions(c -> { });
                    h.frameOptions(f -> f.deny());
                    h.referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER));
                    h.httpStrictTransportSecurity(s -> s.includeSubDomains(true).maxAgeInSeconds(31_536_000));
                    h.contentSecurityPolicy(c -> c.policyDirectives(docsPublic
                            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
                            : "default-src 'none'; frame-ancestors 'none'"));
                    h.addHeaderWriter((request, response) -> response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store"));
                })
                .authorizeHttpRequests(a -> {
                    a.requestMatchers("/actuator/health", "/actuator/health/**", "/actuator/info", "/actuator/prometheus").permitAll();
                    a.requestMatchers(HttpMethod.POST, "/api/v1/auth/token").permitAll();
                    if (docsPublic) {
                        a.requestMatchers("/v3/api-docs", "/v3/api-docs/**", "/swagger-ui.html", "/swagger-ui/**").permitAll();
                    }
                    a.requestMatchers("/api/**").authenticated();
                    a.anyRequest().denyAll(); // deny by default
                })
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, res, ex) -> {
                            res.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
                            ErrorResponses.write(mapper, req, res, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED",
                                    "Authentication is required");
                        })
                        .accessDeniedHandler((req, res, ex) -> ErrorResponses.write(mapper, req, res, HttpStatus.FORBIDDEN,
                                "ACCESS_DENIED", "You do not have permission to perform this operation")))
                .oauth2ResourceServer(o -> o
                        .jwt(j -> j.jwtAuthenticationConverter(jwtConverter(props)))
                        .authenticationEntryPoint((req, res, ex) -> {
                            res.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer error=\"invalid_token\"");
                            ErrorResponses.write(mapper, req, res, HttpStatus.UNAUTHORIZED, "INVALID_TOKEN",
                                    "The access token is missing, expired or invalid");
                        })
                        .accessDeniedHandler((req, res, ex) -> ErrorResponses.write(mapper, req, res, HttpStatus.FORBIDDEN,
                                "ACCESS_DENIED", "You do not have permission to perform this operation")))
                .addFilterAfter(rateLimit, BearerTokenAuthenticationFilter.class);
        return http.build();
    }

    /** Maps the configured roles claim to ROLE_* authorities; unknown role names are ignored (least privilege). */
    Converter<Jwt, AbstractAuthenticationToken> jwtConverter(SecurityProperties props) {
        Set<String> known = Arrays.stream(Role.values()).map(Enum::name).collect(Collectors.toSet());
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter((Jwt jwt) -> {
            List<String> claim = jwt.getClaimAsStringList(props.rolesClaim());
            Collection<GrantedAuthority> authorities = (claim == null ? List.<String>of() : claim).stream()
                    .filter(known::contains)
                    .<GrantedAuthority>map(r -> new SimpleGrantedAuthority("ROLE_" + r))
                    .toList();
            return authorities;
        });
        return converter;
    }

    CorsConfigurationSource corsSource(SecurityProperties props) {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(Arrays.stream(props.corsAllowedOrigins().split(",")).map(String::trim)
                .filter(s -> !s.isEmpty()).toList()); // explicit allow-list - never "*" together with credentials
        cors.setAllowedMethods(List.of("GET", "POST", "PATCH", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key", "X-Correlation-Id"));
        cors.setExposedHeaders(List.of("X-Correlation-Id", "Idempotent-Replayed", "Location", "Retry-After"));
        cors.setAllowCredentials(false);
        cors.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", cors);
        return source;
    }
}
