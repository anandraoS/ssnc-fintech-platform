package com.fintechdemo.platform.customer;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/** Customer profile (persistence model). Never serialized directly - see {@link CustomerDtos}. */
@Entity
@Table(name = "customers")
public class Customer {

    @Id
    private UUID id;

    @Column(name = "customer_ref", nullable = false, updatable = false, length = 32)
    private String customerRef;

    @Column(name = "legal_name", nullable = false, length = 200)
    private String legalName;

    @Column(nullable = false, length = 254)
    private String email;

    @Column(length = 32)
    private String phone;

    @Column(name = "tax_id_last4", length = 4)
    private String taxIdLast4;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private CustomerStatus status;

    @Version
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Customer() {
    }

    public Customer(UUID id, String customerRef, String legalName, String email, String phone, String taxIdLast4,
                    Instant now) {
        this.id = id;
        this.customerRef = customerRef;
        this.legalName = legalName;
        this.email = email;
        this.phone = phone;
        this.taxIdLast4 = taxIdLast4;
        this.status = CustomerStatus.ACTIVE;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void updateProfile(String legalName, String email, String phone, Instant now) {
        if (legalName != null) {
            this.legalName = legalName;
        }
        if (email != null) {
            this.email = email;
        }
        if (phone != null) {
            this.phone = phone;
        }
        this.updatedAt = now;
    }

    public void changeStatus(CustomerStatus next, Instant now) {
        this.status = next;
        this.updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public String getCustomerRef() {
        return customerRef;
    }

    public String getLegalName() {
        return legalName;
    }

    public String getEmail() {
        return email;
    }

    public String getPhone() {
        return phone;
    }

    public String getTaxIdLast4() {
        return taxIdLast4;
    }

    public CustomerStatus getStatus() {
        return status;
    }

    /** Wrapper type on purpose: Spring Data decides new-vs-existing from a null version (see ADR-005 notes). */
    public Long getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
