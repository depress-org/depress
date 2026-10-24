import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { coverage: {
  provider: 'v8', reporter: ['text', 'json-summary'],
  include: ['src/**/*.ts'], exclude: ['src/**/__tests__/**'],
  thresholds: { statements: 85, branches: 70, functions: 85, lines: 85 },
} } })
