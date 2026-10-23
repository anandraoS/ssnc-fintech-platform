package com.fintechdemo.platform.security;

import com.fintechdemo.platform.transaction.TransactionType;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Resource-level (object-level) authorization decisions as pure functions - no I/O, trivially unit-testable.
 * Role checks guard WHAT an endpoint does; this class guards WHICH objects the caller may touch (OWASP API1 / BOLA).
 */
@Component
public class AccessPolicy {

    public boolean canViewCustomer(AuthenticatedUser user, UUID customerId) {
        return user.isStaff() || ownsCustomer(user, customerId);
    }

    public boolean canViewAccount(AuthenticatedUser user, UUID accountOwnerCustomerId) {
        return user.isStaff() || ownsCustomer(user, accountOwnerCustomerId);
    }

    /** Full (unmasked) PII is visible to the customer themself and to operators; support agents see masked values. */
    public boolean canSeeUnmaskedPii(AuthenticatedUser user, UUID customerId) {
        return user.isOperator() || ownsCustomer(user, customerId);
    }

    /**
     * May the caller submit this money movement? CUSTOMER: only against accounts of their own customer (a transfer must
     * stay inside the same customer). Operators may submit on a customer's behalf. SUPPORT_AGENT is read-only.
     */
    public boolean canSubmit(AuthenticatedUser user, TransactionType type, UUID sourceOwnerCustomerId,
                             UUID targetOwnerCustomerId) {
        if (user.isOperator()) {
            return true;
        }
        if (!user.has(Role.CUSTOMER)) {
            return false;
        }
        return switch (type) {
            case DEPOSIT -> ownsCustomer(user, targetOwnerCustomerId);
            case WITHDRAWAL -> ownsCustomer(user, sourceOwnerCustomerId);
            case TRANSFER -> ownsCustomer(user, sourceOwnerCustomerId) && ownsCustomer(user, targetOwnerCustomerId);
        };
    }

    public boolean canViewTransaction(AuthenticatedUser user, UUID sourceOwnerCustomerId, UUID targetOwnerCustomerId) {
        return user.isStaff() || ownsCustomer(user, sourceOwnerCustomerId) || ownsCustomer(user, targetOwnerCustomerId);
    }

    public boolean canCancel(AuthenticatedUser user, String submittedBy, UUID sourceOwnerCustomerId,
                             UUID targetOwnerCustomerId) {
        if (user.isOperator()) {
            return true;
        }
        return user.has(Role.CUSTOMER) && user.subject().equals(submittedBy)
                && canViewTransaction(user, sourceOwnerCustomerId, targetOwnerCustomerId);
    }

    /** Maker-checker: an operator can never approve or reject a transaction they submitted themselves. */
    public boolean canReview(AuthenticatedUser user, String submittedBy) {
        return user.isOperator() && !user.subject().equals(submittedBy);
    }

    private boolean ownsCustomer(AuthenticatedUser user, UUID customerId) {
        return user.customerId() != null && customerId != null && user.customerId().equals(customerId);
    }
}
