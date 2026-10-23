package com.fintechdemo.platform.security;

/** Application roles (mapped from the {@code roles} JWT claim to {@code ROLE_*} authorities). */
public enum Role {
    /** End customer: sees and operates only accounts owned by their own customer record. */
    CUSTOMER,
    /** Read-only staff: can look up customers/accounts/transactions (PII masked), cannot move money. */
    SUPPORT_AGENT,
    /** Operations: investigates, approves pending transactions, resolves reconciliation. */
    OPERATIONS_ANALYST,
    /** Administrator: customer/account lifecycle and platform administration. */
    ADMIN
}
