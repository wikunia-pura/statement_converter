import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the pure logic: converters, shared money/date code, main-process
 * helpers that need no Electron. Standalone on purpose — vite.config.ts roots
 * everything at src/renderer, which the tests must not inherit.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Day keys, deadlines and DST edges are asserted in the office's timezone,
    // whatever the machine running the tests is set to.
    env: { TZ: 'Europe/Warsaw' },
  },
});
