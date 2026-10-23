package com.fintechdemo.platform.customer;

import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.customer.CustomerDtos.ChangeStatusRequest;
import com.fintechdemo.platform.customer.CustomerDtos.CreateCustomerRequest;
import com.fintechdemo.platform.customer.CustomerDtos.CustomerResponse;
import com.fintechdemo.platform.customer.CustomerDtos.UpdateCustomerRequest;
import com.fintechdemo.platform.security.AuthenticatedUser;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/customers")
@Tag(name = "Customers")
public class CustomerController {

    private final CustomerService service;

    public CustomerController(CustomerService service) {
        this.service = service;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public ResponseEntity<CustomerResponse> create(@Valid @RequestBody CreateCustomerRequest request, AuthenticatedUser user) {
        CustomerResponse created = service.create(request, user);
        return ResponseEntity.created(URI.create("/api/v1/customers/" + created.id())).body(created);
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPPORT_AGENT','OPERATIONS_ANALYST','ADMIN')")
    public PageResponse<CustomerResponse> search(@RequestParam(required = false) String q,
                                                 @RequestParam(required = false) CustomerStatus status,
                                                 Pageable pageable, AuthenticatedUser user) {
        return service.search(q, status, pageable, user);
    }

    @GetMapping("/{id}")
    public CustomerResponse get(@PathVariable UUID id, AuthenticatedUser user) {
        return service.get(id, user);
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public CustomerResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateCustomerRequest request,
                                   AuthenticatedUser user) {
        return service.update(id, request, user);
    }

    @PostMapping("/{id}/suspend")
    @PreAuthorize("hasRole('ADMIN')")
    public CustomerResponse suspend(@PathVariable UUID id, @Valid @RequestBody ChangeStatusRequest request,
                                    AuthenticatedUser user) {
        return service.suspend(id, request.reason(), user);
    }

    @PostMapping("/{id}/reactivate")
    @PreAuthorize("hasRole('ADMIN')")
    public CustomerResponse reactivate(@PathVariable UUID id, AuthenticatedUser user) {
        return service.reactivate(id, user);
    }
}
