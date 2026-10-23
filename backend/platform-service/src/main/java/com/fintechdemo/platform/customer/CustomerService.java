package com.fintechdemo.platform.customer;

import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.common.Masking;
import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.common.PageableSupport;
import com.fintechdemo.platform.customer.CustomerDtos.CreateCustomerRequest;
import com.fintechdemo.platform.customer.CustomerDtos.CustomerResponse;
import com.fintechdemo.platform.customer.CustomerDtos.UpdateCustomerRequest;
import com.fintechdemo.platform.security.AccessPolicy;
import com.fintechdemo.platform.security.AuthenticatedUser;
import jakarta.persistence.criteria.Predicate;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CustomerService {

    private static final Set<String> SORTABLE = Set.of("legalName", "customerRef", "createdAt", "status");

    private final CustomerRepository customers;
    private final AuditService audit;
    private final AccessPolicy policy;
    private final Clock clock;

    public CustomerService(CustomerRepository customers, AuditService audit, AccessPolicy policy, Clock clock) {
        this.customers = customers;
        this.audit = audit;
        this.policy = policy;
        this.clock = clock;
    }

    @Transactional
    public CustomerResponse create(CreateCustomerRequest request, AuthenticatedUser actor) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        if (customers.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("DUPLICATE_EMAIL", "A customer with this e-mail already exists");
        }
        Customer customer = new Customer(UUID.randomUUID(), newReference(), request.legalName().trim(), email,
                request.phone(), request.taxIdLast4(), Instant.now(clock));
        customers.saveAndFlush(customer);
        audit.record(actor, "CUSTOMER_CREATED", "CUSTOMER", customer.getId(), "ref=" + customer.getCustomerRef());
        return toResponse(customer, true);
    }

    @Transactional(readOnly = true)
    public CustomerResponse get(UUID id, AuthenticatedUser actor) {
        Customer customer = requireVisible(id, actor);
        return toResponse(customer, policy.canSeeUnmaskedPii(actor, id));
    }

    @Transactional(readOnly = true)
    public PageResponse<CustomerResponse> search(String q, CustomerStatus status, Pageable pageable, AuthenticatedUser actor) {
        Pageable page = PageableSupport.restrictSort(pageable, SORTABLE, Sort.by(Sort.Direction.ASC, "legalName"));
        Specification<Customer> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (q != null && !q.isBlank()) {
                String like = "%" + q.trim().toLowerCase(Locale.ROOT).replace("%", "").replace("_", "") + "%";
                predicates.add(cb.or(cb.like(cb.lower(root.get("legalName")), like),
                        cb.like(cb.lower(root.get("email")), like),
                        cb.like(cb.lower(root.get("customerRef")), like)));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        return PageResponse.of(customers.findAll(spec, page), c -> toResponse(c, policy.canSeeUnmaskedPii(actor, c.getId())));
    }

    @Transactional
    public CustomerResponse update(UUID id, UpdateCustomerRequest request, AuthenticatedUser actor) {
        Customer customer = customers.findById(id).orElseThrow(() -> notFound());
        if (request.email() != null) {
            String email = request.email().trim().toLowerCase(Locale.ROOT);
            customers.findByEmailIgnoreCase(email).filter(other -> !other.getId().equals(id)).ifPresent(other -> {
                throw ApiException.conflict("DUPLICATE_EMAIL", "A customer with this e-mail already exists");
            });
            customer.updateProfile(request.legalName(), email, request.phone(), Instant.now(clock));
        } else {
            customer.updateProfile(request.legalName(), null, request.phone(), Instant.now(clock));
        }
        customers.saveAndFlush(customer);
        // audit lists WHICH fields changed, never the values (PII stays out of the trail's free text)
        audit.record(actor, "CUSTOMER_UPDATED", "CUSTOMER", id, "fields=" + changedFields(request));
        return toResponse(customer, true);
    }

    @Transactional
    public CustomerResponse suspend(UUID id, String reason, AuthenticatedUser actor) {
        Customer customer = customers.findById(id).orElseThrow(CustomerService::notFound);
        if (customer.getStatus() == CustomerStatus.CLOSED) {
            throw ApiException.conflict("INVALID_STATE", "A closed customer cannot be suspended");
        }
        customer.changeStatus(CustomerStatus.SUSPENDED, Instant.now(clock));
        customers.saveAndFlush(customer);
        audit.record(actor, "CUSTOMER_SUSPENDED", "CUSTOMER", id, "reason=" + reason);
        return toResponse(customer, true);
    }

    @Transactional
    public CustomerResponse reactivate(UUID id, AuthenticatedUser actor) {
        Customer customer = customers.findById(id).orElseThrow(CustomerService::notFound);
        if (customer.getStatus() != CustomerStatus.SUSPENDED) {
            throw ApiException.conflict("INVALID_STATE", "Only a suspended customer can be reactivated");
        }
        customer.changeStatus(CustomerStatus.ACTIVE, Instant.now(clock));
        customers.saveAndFlush(customer);
        audit.record(actor, "CUSTOMER_REACTIVATED", "CUSTOMER", id, null);
        return toResponse(customer, true);
    }

    /** Loads a customer if the caller may see it; otherwise responds 404 (not 403) so ids cannot be enumerated. */
    @Transactional(readOnly = true)
    public Customer requireVisible(UUID id, AuthenticatedUser actor) {
        Customer customer = customers.findById(id).orElseThrow(CustomerService::notFound);
        if (!policy.canViewCustomer(actor, id)) {
            audit.recordIndependent(actor, "ACCESS_DENIED", "CUSTOMER", id, "object-level authorization failed");
            throw notFound();
        }
        return customer;
    }

    private static ApiException notFound() {
        return ApiException.notFound("CUSTOMER_NOT_FOUND", "Customer not found");
    }

    private static String newReference() {
        return "CUS-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
    }

    private static String changedFields(UpdateCustomerRequest r) {
        List<String> fields = new ArrayList<>();
        if (r.legalName() != null) {
            fields.add("legalName");
        }
        if (r.email() != null) {
            fields.add("email");
        }
        if (r.phone() != null) {
            fields.add("phone");
        }
        return String.join(",", fields);
    }

    static CustomerResponse toResponse(Customer c, boolean unmasked) {
        return new CustomerResponse(c.getId(), c.getCustomerRef(), c.getLegalName(),
                unmasked ? c.getEmail() : Masking.email(c.getEmail()),
                unmasked ? c.getPhone() : Masking.phone(c.getPhone()),
                c.getTaxIdLast4() == null ? null : "****", // tax id fragments are never returned over the API
                c.getStatus(), c.getVersion(), c.getCreatedAt(), c.getUpdatedAt());
    }
}
