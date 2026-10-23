package com.fintechdemo.platform.security;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

/**
 * LOCAL-ONLY token issuer so the demo runs without an identity provider. It signs HS256 JWTs with an in-memory key that
 * is random per start-up unless LOCAL_ISSUER_HMAC_SECRET is supplied. In real environments this whole configuration is
 * disabled and Spring's resource server validates tokens issued by an OIDC provider (issuer-uri + JWKS, RS256/ES256).
 * The application refuses to start if this is enabled together with a production profile.
 */
@Configuration
@ConditionalOnProperty(prefix = "app.security.local-issuer", name = "enabled", havingValue = "true")
public class LocalIssuerConfig {

    public static final String ISSUER = "https://local-issuer.invalid/demo";
    private static final Logger log = LoggerFactory.getLogger(LocalIssuerConfig.class);

    @Bean
    SecretKey localIssuerKey(SecurityProperties props, Environment env) {
        if (env.acceptsProfiles(Profiles.of("prod", "production"))) {
            throw new IllegalStateException("The local token issuer must never run with a production profile");
        }
        byte[] key;
        String configured = props.localIssuer().hmacSecret();
        if (configured == null || configured.isBlank()) {
            key = new byte[32];
            new SecureRandom().nextBytes(key);
            log.warn("LOCAL token issuer enabled with a random per-start key (demo/local use only)");
        } else {
            key = configured.getBytes(StandardCharsets.UTF_8);
            if (key.length < 32) {
                throw new IllegalStateException("LOCAL_ISSUER_HMAC_SECRET must be at least 32 bytes");
            }
        }
        return new SecretKeySpec(key, "HmacSHA256");
    }

    @Bean
    JwtDecoder jwtDecoder(SecretKey localIssuerKey) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(localIssuerKey).macAlgorithm(MacAlgorithm.HS256).build();
        OAuth2TokenValidator<Jwt> validator = new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(), JwtValidators.createDefaultWithIssuer(ISSUER));
        decoder.setJwtValidator(validator);
        return decoder;
    }

    @Bean
    JwtEncoder jwtEncoder(SecretKey localIssuerKey) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(localIssuerKey));
    }
}
