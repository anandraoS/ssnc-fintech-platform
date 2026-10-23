package com.fintechdemo.platform.security;

import java.util.Arrays;
import java.util.Collection;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/** The caller as seen by the domain layer: validated JWT claims only, never a database entity. */
public record AuthenticatedUser(String subject, Set<Role> roles, UUID customerId) {

    public AuthenticatedUser {
        roles = roles.isEmpty() ? EnumSet.noneOf(Role.class) : EnumSet.copyOf(roles);
    }

    public boolean has(Role role) {
        return roles.contains(role);
    }

    public boolean hasAny(Role... candidates) {
        return Arrays.stream(candidates).anyMatch(roles::contains);
    }

    /** Staff roles can see across customers; CUSTOMER cannot. */
    public boolean isStaff() {
        return hasAny(Role.SUPPORT_AGENT, Role.OPERATIONS_ANALYST, Role.ADMIN);
    }

    /** Roles allowed to change money-related state on behalf of customers (still subject to maker-checker). */
    public boolean isOperator() {
        return hasAny(Role.OPERATIONS_ANALYST, Role.ADMIN);
    }

    public String rolesAsString() {
        return roles.stream().map(Enum::name).sorted().reduce((a, b) -> a + "," + b).orElse("");
    }

    public static AuthenticatedUser system(String name) {
        return new AuthenticatedUser("system:" + name, Set.of(), null);
    }

    public static AuthenticatedUser from(Authentication authentication, String customerClaim) {
        if (!(authentication instanceof JwtAuthenticationToken token)) {
            throw new IllegalStateException("Unsupported authentication type");
        }
        Jwt jwt = token.getToken();
        Collection<Role> roles = authentication.getAuthorities().stream()
                .map(a -> a.getAuthority())
                .filter(a -> a.startsWith("ROLE_"))
                .map(a -> a.substring(5))
                .flatMap(n -> Arrays.stream(Role.values()).filter(r -> r.name().equals(n)))
                .toList();
        String customer = jwt.getClaimAsString(customerClaim);
        UUID customerId = null;
        if (customer != null) {
            try {
                customerId = UUID.fromString(customer);
            } catch (IllegalArgumentException ignored) {
                customerId = null; // malformed claim: treated as "no customer", so customer-scoped access is denied
            }
        }
        return new AuthenticatedUser(jwt.getSubject(), roles.isEmpty() ? EnumSet.noneOf(Role.class) : EnumSet.copyOf(roles),
                customerId);
    }
}
