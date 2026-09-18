// A small seedable PRNG (mulberry32). The solver samples holdings and runouts,
// so without a seed no two runs agree and a regression fixture can't tell a
// real change from ordinary variance.
export type Rng = () => number

export function makeRng(seed: number): Rng {
  let state = seed >>> 0
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const defaultRng: Rng = Math.random
