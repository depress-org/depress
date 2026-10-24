import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { coverage: {
  provider: 'v8', reporter: ['text', 'json-summary'],
  include: ['src/**/*.ts'], exclude: ['src/**/__tests__/**'],
  // Rounded-down measured baseline, Node 20.20.2; includes untested runtime files.
  thresholds: { statements: 94, branches: 73, functions: 80, lines: 97 },
} } })
