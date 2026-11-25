import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// vitest's default include picks up the Playwright specs in e2e/ (they match *.spec.ts), which
// blows up on Playwright's own describe() - so the vitest suite is scoped explicitly.
// `npm test` runs the unit suite; `npm run test:e2e` runs Playwright separately. The server's own
// tests live outside its tsconfig (which only builds src), so they are included here.
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Split stable libraries from app code: a settings change should not invalidate the
        // cached MUI/React vendor bundles, and the 500 kB single-chunk warning goes away.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('xlsx')) return 'xlsx'
          if (id.includes('qrcode')) return 'qrcode'
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui'
          if (id.includes('react-router')) return 'router'
          if (id.includes('react') || id.includes('scheduler')) return 'react'
          return 'vendor'
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/tests/**/*.test.ts'],
  },
})
