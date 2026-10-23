import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**'],
      // Baseline measured on 2026-10-23 (34 tests). These thresholds exist to
      // catch regressions, not as an aspirational target — raise them as real
      // coverage grows, never lower them to make a drop pass.
      thresholds: {
        statements: 25,
        branches: 19,
        functions: 15,
        lines: 27,
      },
    },
  },
})
