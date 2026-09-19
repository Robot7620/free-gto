import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // A flop solve is genuinely a few seconds of arithmetic, and the reference
    // tests enumerate every runout on top of that. Vitest's 5s default fails
    // those on duration alone, which reads as a broken suite rather than a slow
    // one.
    testTimeout: 120_000,
  },
})
