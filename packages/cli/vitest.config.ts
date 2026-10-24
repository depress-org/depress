import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      // Baseline measured on 2026-10-24 (41 tests, Node 20.20.2). These thresholds exist to
      // catch regressions, not as an aspirational target — raise them as real
      // coverage grows, never lower them to make a drop pass.
      thresholds: {
        statements: 37,
        branches: 23,
        functions: 34,
        lines: 37,
      },
    },
  },
})
