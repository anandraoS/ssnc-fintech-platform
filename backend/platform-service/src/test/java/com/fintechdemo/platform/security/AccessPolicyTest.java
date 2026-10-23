package com.fintechdemo.platform.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.transaction.TransactionType;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Authorization decisions are pure functions, so the whole matrix is cheap to test exhaustively. */
class AccessPolicyTest {

    private final AccessPolicy policy = new AccessPolicy();
    private static final UUID C1 = UUID.randomUUID();
    private static final UUID C2 = UUID.randomUUID();

    private static AuthenticatedUser customer(String name, UUID customerId) {
        return new AuthenticatedUser(name, Set.of(Role.CUSTOMER), customerId);
    }

    private static AuthenticatedUser staff(String name, Role role) {
        return new AuthenticatedUser(name, Set.of(role), null);
    }

    @Test
    void customersSeeOnlyTheirOwnObjects() {
        AuthenticatedUser alice = customer("alice", C1);
        assertThat(policy.canViewAccount(alice, C1)).isTrue();
        assertThat(policy.canViewAccount(alice, C2)).isFalse();
        assertThat(policy.canViewCustomer(alice, C2)).isFalse();
        assertThat(policy.canViewTransaction(alice, C1, null)).isTrue();
        assertThat(policy.canViewTransaction(alice, C2, null)).isFalse();
        assertThat(policy.canViewTransaction(alice, null, C1)).isTrue();
    }

    @Test
    @DisplayName("a CUSTOMER token without a customer claim matches nothing (including null owners)")
    void orphanCustomerMatchesNothing() {
        AuthenticatedUser orphan = customer("orphan", null);
        assertThat(policy.canViewAccount(orphan, C1)).isFalse();
        assertThat(policy.canViewAccount(orphan, null)).isFalse();
        assertThat(policy.canSubmit(orphan, TransactionType.DEPOSIT, null, null)).isFalse();
    }

    @Test
    void staffCanViewButOnlyOperatorsCanSeeUnmaskedPii() {
        for (Role r : new Role[]{Role.SUPPORT_AGENT, Role.OPERATIONS_ANALYST, Role.ADMIN}) {
            assertThat(policy.canViewAccount(staff("s", r), C1)).isTrue();
        }
        assertThat(policy.canSeeUnmaskedPii(staff("s", Role.SUPPORT_AGENT), C1)).isFalse();
        assertThat(policy.canSeeUnmaskedPii(staff("o", Role.OPERATIONS_ANALYST), C1)).isTrue();
        assertThat(policy.canSeeUnmaskedPii(customer("alice", C1), C1)).isTrue();
        assertThat(policy.canSeeUnmaskedPii(customer("alice", C1), C2)).isFalse();
    }

    @Test
    @DisplayName("submission rules per type and role")
    void submissionMatrix() {
        AuthenticatedUser alice = customer("alice", C1);
        assertThat(policy.canSubmit(alice, TransactionType.DEPOSIT, null, C1)).isTrue();
        assertThat(policy.canSubmit(alice, TransactionType.DEPOSIT, null, C2)).isFalse();
        assertThat(policy.canSubmit(alice, TransactionType.WITHDRAWAL, C1, null)).isTrue();
        assertThat(policy.canSubmit(alice, TransactionType.WITHDRAWAL, C2, null)).isFalse();
        assertThat(policy.canSubmit(alice, TransactionType.TRANSFER, C1, C1)).isTrue();
        assertThat(policy.canSubmit(alice, TransactionType.TRANSFER, C1, C2)).isFalse(); // may not push money to others
        assertThat(policy.canSubmit(alice, TransactionType.TRANSFER, C2, C1)).isFalse(); // may not pull from others
        assertThat(policy.canSubmit(staff("s", Role.SUPPORT_AGENT), TransactionType.DEPOSIT, null, C1)).isFalse();
        assertThat(policy.canSubmit(staff("o", Role.OPERATIONS_ANALYST), TransactionType.TRANSFER, C1, C2)).isTrue();
        assertThat(policy.canSubmit(staff("a", Role.ADMIN), TransactionType.WITHDRAWAL, C2, null)).isTrue();
    }

    @Test
    @DisplayName("maker-checker: nobody reviews their own submission, and customers/support never review")
    void makerChecker() {
        assertThat(policy.canReview(staff("omar", Role.OPERATIONS_ANALYST), "omar")).isFalse();
        assertThat(policy.canReview(staff("olivia", Role.OPERATIONS_ANALYST), "omar")).isTrue();
        assertThat(policy.canReview(staff("adam", Role.ADMIN), "alice")).isTrue();
        assertThat(policy.canReview(staff("sam", Role.SUPPORT_AGENT), "alice")).isFalse();
        assertThat(policy.canReview(customer("alice", C1), "bob")).isFalse();
    }

    @Test
    void cancellationRules() {
        AuthenticatedUser alice = customer("alice", C1);
        assertThat(policy.canCancel(alice, "alice", C1, null)).isTrue();
        assertThat(policy.canCancel(alice, "bob", C1, null)).isFalse(); // same customer, different submitter
        assertThat(policy.canCancel(customer("eve", C2), "eve", C1, null)).isFalse(); // not her account
        assertThat(policy.canCancel(staff("o", Role.OPERATIONS_ANALYST), "alice", C1, null)).isTrue();
        assertThat(policy.canCancel(staff("s", Role.SUPPORT_AGENT), "alice", C1, null)).isFalse();
    }
}
