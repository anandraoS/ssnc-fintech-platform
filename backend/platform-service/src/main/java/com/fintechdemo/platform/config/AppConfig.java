package com.fintechdemo.platform.config;

import com.fintechdemo.platform.security.AuthenticatedUser;
import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import java.time.Clock;
import org.springdoc.core.utils.SpringDocUtils;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
@OpenAPIDefinition(
        info = @Info(title = "Enterprise Investment Account and Transaction Management Platform API", version = "1.0.0",
                description = "Synthetic educational API. All data is fictional; no real money moves."),
        security = @SecurityRequirement(name = "bearerAuth"))
@SecurityScheme(name = "bearerAuth", type = SecuritySchemeType.HTTP, scheme = "bearer", bearerFormat = "JWT")
public class AppConfig {

    static {
        // the resolved caller is injected by CurrentUserArgumentResolver, not read from the request
        SpringDocUtils.getConfig().addRequestWrapperToIgnore(AuthenticatedUser.class);
    }

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /** Explicit transaction boundaries in code (processor, idempotent submit) use this template. */
    @Bean
    TransactionTemplate transactionTemplate(PlatformTransactionManager tm) {
        return new TransactionTemplate(tm);
    }

    /** Injected by parameter NAME (readOnlyTransactionTemplate) - do not mark either template @Primary: primary beats name matching. */
    @Bean
    TransactionTemplate readOnlyTransactionTemplate(PlatformTransactionManager tm) {
        TransactionTemplate template = new TransactionTemplate(tm);
        template.setReadOnly(true);
        return template;
    }
}
