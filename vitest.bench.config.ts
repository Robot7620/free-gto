import { defineConfig } from 'vite'

// The measurements under bench/ are not tests - they assert nothing, they take
// tens of minutes, and they exist so the tables in TODO.md and the briefs can
// be reproduced rather than taken on trust. `npm test` excludes them; this runs
// them on their own.
export default defineConfig({
  test: {
    include: ['bench/**/*.test.ts'],
    testTimeout: 7_200_000,
    // Console output per file arrives when the file finishes, and a flop sweep
    // is long enough that watching it matters.
    reporters: ['verbose'],
  },
})
