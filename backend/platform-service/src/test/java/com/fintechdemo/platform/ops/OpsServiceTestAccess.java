package com.fintechdemo.platform.ops;

import java.util.List;

/** Test-only bridge to the package-private percentile helper. */
public final class OpsServiceTestAccess {

    private OpsServiceTestAccess() {
    }

    public static long percentile(List<Long> sorted, int p) {
        return OpsService.percentile(sorted, p);
    }
}
