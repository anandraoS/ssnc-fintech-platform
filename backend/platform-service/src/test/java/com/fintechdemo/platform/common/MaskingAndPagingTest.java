package com.fintechdemo.platform.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

class MaskingAndPagingTest {

    @Test
    void masksEmailPhoneAndAccountNumber() {
        assertThat(Masking.email("alice@example.test")).isEqualTo("a***@example.test");
        assertThat(Masking.email("a@example.test")).isEqualTo("***@example.test");
        assertThat(Masking.email(null)).isNull();
        assertThat(Masking.phone("+1-555-0101")).isEqualTo("***01");
        assertThat(Masking.phone("12")).isEqualTo("***");
        assertThat(Masking.accountNumber("ACC-1000000001")).isEqualTo("ACC-******0001");
        assertThat(Masking.accountNumber("short")).isEqualTo("****");
    }

    @Test
    void defaultSortIsAppliedWhenUnsorted() {
        var page = PageableSupport.restrictSort(PageRequest.of(1, 10), Set.of("createdAt"), Sort.by("createdAt").descending());
        assertThat(page.getSort().getOrderFor("createdAt").isDescending()).isTrue();
        assertThat(page.getPageNumber()).isEqualTo(1);
    }

    @Test
    void allowedSortGetsAStableTieBreak() {
        var page = PageableSupport.restrictSort(PageRequest.of(0, 10, Sort.by("amount")), Set.of("amount"), Sort.by("amount"));
        assertThat(page.getSort().stream().map(Sort.Order::getProperty)).containsExactly("amount", "id");
    }

    @Test
    void unknownSortPropertyIsRejected() {
        assertThatThrownBy(() -> PageableSupport.restrictSort(PageRequest.of(0, 10, Sort.by("passwordHash")), Set.of("amount"), Sort.unsorted()))
                .isInstanceOf(ApiException.class).hasMessageContaining("passwordHash");
    }
}
