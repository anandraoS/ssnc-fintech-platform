package com.fintechdemo.platform.account;

import com.fintechdemo.platform.account.AccountDtos.AccountResponse;
import com.fintechdemo.platform.account.AccountDtos.BalanceResponse;
import com.fintechdemo.platform.account.AccountDtos.OpenAccountRequest;
import com.fintechdemo.platform.account.AccountDtos.SuspendAccountRequest;
import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.security.AuthenticatedUser;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "Accounts")
public class AccountController {

    private final AccountService service;

    public AccountController(AccountService service) {
        this.service = service;
    }

    @PostMapping("/customers/{customerId}/accounts")
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public ResponseEntity<AccountResponse> open(@PathVariable UUID customerId, @Valid @RequestBody OpenAccountRequest request,
                                                AuthenticatedUser user) {
        AccountResponse created = service.open(customerId, request, user);
        return ResponseEntity.created(URI.create("/api/v1/accounts/" + created.id())).body(created);
    }

    @GetMapping("/accounts")
    public PageResponse<AccountResponse> search(@RequestParam(required = false) UUID customerId,
                                                @RequestParam(required = false) AccountStatus status,
                                                @RequestParam(required = false) AccountType type,
                                                @RequestParam(required = false) String q,
                                                Pageable pageable, AuthenticatedUser user) {
        return service.search(customerId, status, type, q, pageable, user);
    }

    @GetMapping("/accounts/{id}")
    public AccountResponse get(@PathVariable UUID id, AuthenticatedUser user) {
        return service.get(id, user);
    }

    @GetMapping("/accounts/{id}/balance")
    public BalanceResponse balance(@PathVariable UUID id, AuthenticatedUser user) {
        return service.balance(id, user);
    }

    @PostMapping("/accounts/{id}/activate")
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public AccountResponse activate(@PathVariable UUID id, AuthenticatedUser user) {
        return service.activate(id, user);
    }

    @PostMapping("/accounts/{id}/suspend")
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public AccountResponse suspend(@PathVariable UUID id, @Valid @RequestBody SuspendAccountRequest request,
                                   AuthenticatedUser user) {
        return service.suspend(id, request.reason(), user);
    }

    @PostMapping("/accounts/{id}/close")
    @PreAuthorize("hasRole('ADMIN')")
    public AccountResponse close(@PathVariable UUID id, AuthenticatedUser user) {
        return service.close(id, user);
    }
}
