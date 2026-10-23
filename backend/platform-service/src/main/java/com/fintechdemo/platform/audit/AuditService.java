package com.fintechdemo.platform.audit;

import com.fintechdemo.platform.common.CorrelationIdFilter;
import com.fintechdemo.platform.security.AuthenticatedUser;
import java.time.Clock;
import java.time.Instant;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes audit events. {@link #record} joins the caller's transaction so the audit row commits or rolls back with the
 * business change; {@link #recordDenied} uses a new transaction because the caller is about to throw (and roll back)
 * but the denial itself must still be audited.
 */
@Service
public class AuditService {

    private static final int MAX_DETAILS = 2000;

    private final AuditEventRepository repository;
    private final Clock clock;

    public AuditService(AuditEventRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(AuthenticatedUser actor, String action, String entityType, Object entityId, String details) {
        save(actor, action, entityType, entityId, details);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordIndependent(AuthenticatedUser actor, String action, String entityType, Object entityId, String details) {
        save(actor, action, entityType, entityId, details);
    }

    private void save(AuthenticatedUser actor, String action, String entityType, Object entityId, String details) {
        String text = details == null ? null : details.length() > MAX_DETAILS ? details.substring(0, MAX_DETAILS) : details;
        repository.save(new AuditEvent(Instant.now(clock), actor.subject(), actor.rolesAsString(), action, entityType,
                String.valueOf(entityId), MDC.get(CorrelationIdFilter.MDC_KEY), text));
    }
}
