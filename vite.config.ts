import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// vitest's default include picks up the Playwright specs in e2e/ (they match *.spec.ts), which
// blows up on Playwright's own describe() - so the vitest suite is scoped to src/ explicitly.
// `npm test` runs the unit suite; `npm run test:e2e` runs Playwright separately.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
