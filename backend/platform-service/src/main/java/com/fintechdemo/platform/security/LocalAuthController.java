package com.fintechdemo.platform.security;

import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.common.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.PostConstruct;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Local-profile "login" so the Angular app and the tests can obtain tokens. All users are SYNTHETIC; their shared
 * password comes from LOCAL_DEMO_PASSWORD (a dummy default is documented in .env.example). Absent in real deployments.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(prefix = "app.security.local-issuer", name = "enabled", havingValue = "true")
@Tag(name = "Authentication (local profile only)")
public class LocalAuthController {

    public record TokenRequest(@NotBlank @Size(max = 64) String username, @NotBlank @Size(max = 128) String password) {
    }

    public record TokenResponse(String accessToken, String tokenType, long expiresInSeconds, String username,
                                List<String> roles, UUID customerId) {
    }

    private record DemoUser(String username, Role role, UUID customerId) {
    }

    private static final List<DemoUser> USERS = List.of(
            new DemoUser("alice.customer", Role.CUSTOMER, UUID.fromString("00000000-0000-4000-8000-000000000001")),
            new DemoUser("bob.customer", Role.CUSTOMER, UUID.fromString("00000000-0000-4000-8000-000000000002")),
            new DemoUser("carla.customer", Role.CUSTOMER, UUID.fromString("00000000-0000-4000-8000-000000000003")),
            new DemoUser("sam.support", Role.SUPPORT_AGENT, null),
            new DemoUser("omar.ops", Role.OPERATIONS_ANALYST, null),
            new DemoUser("olivia.ops", Role.OPERATIONS_ANALYST, null),
            new DemoUser("adam.admin", Role.ADMIN, null));

    private final JwtEncoder encoder;
    private final SecurityProperties props;
    private final AuditService audit;
    private final Clock clock;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder(10);
    private String passwordHash;
    private String decoyHash;

    public LocalAuthController(JwtEncoder encoder, SecurityProperties props, AuditService audit, Clock clock) {
        this.encoder = encoder;
        this.props = props;
        this.audit = audit;
        this.clock = clock;
    }

    @PostConstruct
    void init() {
        passwordHash = passwordEncoder.encode(props.localIssuer().demoPassword());
        decoyHash = passwordEncoder.encode(UUID.randomUUID().toString());
    }

    @Operation(summary = "Obtain a demo access token (local profile only)", security = {})
    @PostMapping("/auth/token")
    public TokenResponse token(@Valid @RequestBody TokenRequest request) {
        DemoUser user = USERS.stream().filter(u -> u.username().equals(request.username())).findFirst().orElse(null);
        // always run one BCrypt comparison so response time does not reveal whether the username exists
        boolean ok = passwordEncoder.matches(request.password(), user != null ? passwordHash : decoyHash) && user != null;
        if (!ok) {
            audit.recordIndependent(AuthenticatedUser.system("auth"), "LOGIN_FAILED", "USER",
                    sanitize(request.username()), "invalid credentials");
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid username or password");
        }
        Instant now = Instant.now(clock);
        Instant expiry = now.plus(props.localIssuer().tokenTtl());
        JwtClaimsSet.Builder claims = JwtClaimsSet.builder()
                .issuer(LocalIssuerConfig.ISSUER)
                .subject(user.username())
                .issuedAt(now)
                .expiresAt(expiry)
                .id(UUID.randomUUID().toString())
                .claim(props.rolesClaim(), List.of(user.role().name()));
        if (user.customerId() != null) {
            claims.claim(props.customerClaim(), user.customerId().toString());
        }
        String jwt = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims.build()))
                .getTokenValue();
        audit.recordIndependent(new AuthenticatedUser(user.username(), java.util.EnumSet.of(user.role()), user.customerId()),
                "LOGIN_SUCCEEDED", "USER", user.username(), null);
        return new TokenResponse(jwt, "Bearer", props.localIssuer().tokenTtl().toSeconds(), user.username(),
                List.of(user.role().name()), user.customerId());
    }

    private static String sanitize(String s) {
        String trimmed = s.length() > 50 ? s.substring(0, 50) : s;
        return trimmed.replaceAll("[^A-Za-z0-9._@-]", "?");
    }
}
