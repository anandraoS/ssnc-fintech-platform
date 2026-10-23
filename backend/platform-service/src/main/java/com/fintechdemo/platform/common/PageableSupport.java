package com.fintechdemo.platform.common;

import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

/**
 * Sort-property allow-list. Letting clients sort by arbitrary property names would expose internal fields and make
 * query plans unpredictable (unindexed sorts on large tables).
 */
public final class PageableSupport {

    private PageableSupport() {
    }

    public static Pageable restrictSort(Pageable pageable, Set<String> allowed, Sort defaultSort) {
        if (pageable.getSort().isUnsorted()) {
            return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), defaultSort);
        }
        for (Sort.Order order : pageable.getSort()) {
            if (!allowed.contains(order.getProperty())) {
                throw ApiException.badRequest("INVALID_SORT", "Unsupported sort property: " + order.getProperty())
                        .with("allowed", allowed.stream().sorted().toList());
            }
        }
        // deterministic tie-break keeps pagination stable
        return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), pageable.getSort().and(Sort.by("id")));
    }
}
