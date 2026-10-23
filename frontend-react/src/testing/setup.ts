import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// The first render of a lazy route pays for a dynamic import; on a loaded machine (parallel test files, CI runners) that can
// exceed Testing Library's 1 s default, which made the very first test of a file flaky. The timeout only bounds waiting.
configure({ asyncUtilTimeout: 5000 });
