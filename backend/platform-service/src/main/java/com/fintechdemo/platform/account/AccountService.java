package com.fintechdemo.platform.account;

import com.fintechdemo.platform.account.AccountDtos.AccountResponse;
import com.fintechdemo.platform.account.AccountDtos.BalanceResponse;
import com.fintechdemo.platform.account.AccountDtos.OpenAccountRequest;
import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.common.Masking;
import com.fintechdemo.platform.common.MoneyPolicy;
import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.common.PageableSupport;
import com.fintechdemo.platform.customer.Customer;
import com.fintechdemo.platform.customer.CustomerRepository;
import com.fintechdemo.platform.customer.CustomerStatus;
import com.fintechdemo.platform.security.AccessPolicy;
import com.fintechdemo.platform.security.AuthenticatedUser;
import jakarta.persistence.criteria.Predicate;
import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    private static final Set<String> SORTABLE = Set.of("accountNumber", "openedAt", "balance", "status", "accountType");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final AccountRepository accounts;
    private final CustomerRepository customers;
    private final AccountClosureGuard closureGuard;
    private final AuditService audit;
    private final AccessPolicy policy;
    private final Clock clock;

    public AccountService(AccountRepository accounts, CustomerRepository customers, AccountClosureGuard closureGuard,
                          AuditService audit, AccessPolicy policy, Clock clock) {
        this.accounts = accounts;
        this.customers = customers;
        this.closureGuard = closureGuard;
        this.audit = audit;
        this.policy = policy;
        this.clock = clock;
    }

    @Transactional
    public AccountResponse open(UUID customerId, OpenAccountRequest request, AuthenticatedUser actor) {
        Customer customer = customers.findById(customerId)
                .orElseThrow(() -> ApiException.notFound("CUSTOMER_NOT_FOUND", "Customer not found"));
        if (customer.getStatus() != CustomerStatus.ACTIVE) {
            throw ApiException.unprocessable("CUSTOMER_NOT_ACTIVE", "Accounts can only be opened for active customers");
        }
        if (!MoneyPolicy.isSupported(request.currency())) {
            throw ApiException.badRequest("UNSUPPORTED_CURRENCY", "Currency not supported")
                    .with("supported", MoneyPolicy.supportedCurrencies().stream().sorted().toList());
        }
        BigDecimal limit = request.dailyWithdrawalLimit() != null ? request.dailyWithdrawalLimit()
                : request.accountType().defaultDailyWithdrawalLimit();
        // 10 random digits: a collision (~1e-9 per open) surfaces as the unique-constraint 409, and the client retries.
        // (A retry loop inside this transaction would not work: the failed flush marks it rollback-only.)
        Account account = new Account(UUID.randomUUID(), newAccountNumber(), customerId, request.accountType(),
                request.currency(), limit, Instant.now(clock));
        accounts.saveAndFlush(account);
        audit.record(actor, "ACCOUNT_OPENED", "ACCOUNT", account.getId(),
                "type=" + account.getAccountType() + ", currency=" + account.getCurrency()
                        + ", number=" + Masking.accountNumber(account.getAccountNumber()));
        return toResponse(account);
    }

    @Transactional(readOnly = true)
    public AccountResponse get(UUID id, AuthenticatedUser actor) {
        return toResponse(requireVisible(id, actor));
    }

    @Transactional(readOnly = true)
    public BalanceResponse balance(UUID id, AuthenticatedUser actor) {
        Account a = requireVisible(id, actor);
        return new BalanceResponse(a.getId(), a.getCurrency(),
                MoneyPolicy.toDisplay(a.getBalance(), a.getCurrency()),
                MoneyPolicy.toDisplay(a.getMinimumBalance(), a.getCurrency()),
                MoneyPolicy.toDisplay(a.availableBalance(), a.getCurrency()), Instant.now(clock));
    }

    @Transactional(readOnly = true)
    public PageResponse<AccountResponse> search(UUID customerId, AccountStatus status, AccountType type, String q,
                                                Pageable pageable, AuthenticatedUser actor) {
        UUID scope = customerId;
        if (!actor.isStaff()) {
            // customers are always scoped to their own records; asking for someone else's is an object-level violation
            if (actor.customerId() == null || (customerId != null && !customerId.equals(actor.customerId()))) {
                audit.recordIndependent(actor, "ACCESS_DENIED", "CUSTOMER", String.valueOf(customerId),
                        "account search outside own customer scope");
                throw ApiException.notFound("CUSTOMER_NOT_FOUND", "Customer not found");
            }
            scope = actor.customerId();
        }
        UUID finalScope = scope;
        Pageable page = PageableSupport.restrictSort(pageable, SORTABLE, Sort.by(Sort.Direction.DESC, "openedAt"));
        Specification<Account> spec = (root, query, cb) -> {
            List<Predicate> p = new ArrayList<>();
            if (finalScope != null) {
                p.add(cb.equal(root.get("customerId"), finalScope));
            }
            if (status != null) {
                p.add(cb.equal(root.get("status"), status));
            }
            if (type != null) {
                p.add(cb.equal(root.get("accountType"), type));
            }
            if (q != null && !q.isBlank()) {
                p.add(cb.like(root.get("accountNumber"), q.trim().toUpperCase().replace("%", "").replace("_", "") + "%"));
            }
            return cb.and(p.toArray(new Predicate[0]));
        };
        return PageResponse.of(accounts.findAll(spec, page), AccountService::toResponse);
    }

    @Transactional
    public AccountResponse activate(UUID id, AuthenticatedUser actor) {
        Account a = accounts.findById(id).orElseThrow(AccountService::notFound);
        Customer owner = customers.findById(a.getCustomerId()).orElseThrow(AccountService::notFound);
        if (owner.getStatus() != CustomerStatus.ACTIVE) {
            throw ApiException.unprocessable("CUSTOMER_NOT_ACTIVE", "The owning customer is not active");
        }
        AccountStatus before = a.getStatus();
        a.transitionTo(AccountStatus.ACTIVE, null, Instant.now(clock));
        accounts.saveAndFlush(a);
        audit.record(actor, "ACCOUNT_ACTIVATED", "ACCOUNT", id, "from=" + before);
        return toResponse(a);
    }

    @Transactional
    public AccountResponse suspend(UUID id, String reason, AuthenticatedUser actor) {
        Account a = accounts.findById(id).orElseThrow(AccountService::notFound);
        a.transitionTo(AccountStatus.SUSPENDED, reason, Instant.now(clock));
        accounts.saveAndFlush(a);
        audit.record(actor, "ACCOUNT_SUSPENDED", "ACCOUNT", id, "reason=" + reason);
        return toResponse(a);
    }

    @Transactional
    public AccountResponse close(UUID id, AuthenticatedUser actor) {
        // lock the row so no transaction can credit it between the checks below and the status change
        Account a = accounts.lockById(id).orElseThrow(AccountService::notFound);
        if (a.getBalance().signum() != 0) {
            throw ApiException.conflict("ACCOUNT_HAS_BALANCE", "An account with a non-zero balance cannot be closed");
        }
        if (closureGuard.hasInFlightTransactions(id)) {
            throw ApiException.conflict("ACCOUNT_HAS_PENDING_TRANSACTIONS", "Complete or cancel pending transactions first");
        }
        a.transitionTo(AccountStatus.CLOSED, "closed by " + actor.subject(), Instant.now(clock));
        accounts.saveAndFlush(a);
        audit.record(actor, "ACCOUNT_CLOSED", "ACCOUNT", id, null);
        return toResponse(a);
    }

    /** Loads the account if the caller may see it; otherwise 404 (not 403) and an independent ACCESS_DENIED audit row. */
    @Transactional(readOnly = true)
    public Account requireVisible(UUID id, AuthenticatedUser actor) {
        Account a = accounts.findById(id).orElseThrow(AccountService::notFound);
        if (!policy.canViewAccount(actor, a.getCustomerId())) {
            audit.recordIndependent(actor, "ACCESS_DENIED", "ACCOUNT", id, "object-level authorization failed");
            throw notFound();
        }
        return a;
    }

    private static ApiException notFound() {
        return ApiException.notFound("ACCOUNT_NOT_FOUND", "Account not found");
    }

    private static String newAccountNumber() {
        return "ACC-" + String.format("%010d", RANDOM.nextLong(1_000_000_000L, 9_999_999_999L));
    }

    public static AccountResponse toResponse(Account a) {
        String c = a.getCurrency();
        return new AccountResponse(a.getId(), a.getAccountNumber(), a.getCustomerId(), a.getAccountType(), a.getStatus(),
                a.getStatusReason(), c, MoneyPolicy.toDisplay(a.getBalance(), c),
                MoneyPolicy.toDisplay(a.availableBalance(), c), MoneyPolicy.toDisplay(a.getMinimumBalance(), c),
                MoneyPolicy.toDisplay(a.getDailyWithdrawalLimit(), c), a.getVersion(), a.getOpenedAt(), a.getUpdatedAt());
    }
}
