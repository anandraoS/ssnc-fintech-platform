package com.fintechdemo.platform.security;

import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Tells the SPA who the validated caller is (the SPA uses it only for navigation; the server enforces everything). */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Identity")
public class MeController {

    public record MeResponse(String subject, List<String> roles, UUID customerId) {
    }

    @GetMapping("/me")
    public MeResponse me(AuthenticatedUser user) {
        return new MeResponse(user.subject(), user.roles().stream().map(Enum::name).sorted().toList(), user.customerId());
    }
}
