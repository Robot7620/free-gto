import { describe, it, expect } from 'vitest'
import {
  HandSet,
  makeHandSet,
  showdownValues,
  showdownValuesNaive,
  foldValues,
  foldValuesNaive,
} from '../showdown-values'
import { makeRng } from '../rng'

// The fast path replaces a double loop with a single sweep plus a per-card
// blocking correction. It is easy to write something that looks right and is
// quietly biased, so every case here is checked against the naive version
// rather than against expected numbers written by hand.

function randomCase(rng: () => number, maxHands: number, rankSpread: number) {
  const pick = (n: number) => Math.floor(rng() * n)

  // Rank is a function of the cards, exactly as it is in the real solver where
  // both sides read the same showdown table. Both ranges legitimately contain
  // the same holding - they're enumerated independently - and when they do it
  // must score identically. Drawing the two sides' ranks independently would
  // manufacture a deal that cannot exist.
  const rankOf = new Map<string, number>()
  const rankFor = (a: number, b: number): number => {
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`
    let r = rankOf.get(key)
    if (r === undefined) {
      r = pick(rankSpread)
      rankOf.set(key, r)
    }
    return r
  }

  const makeSide = (): { set: HandSet; reach: Float64Array } => {
    const count = 1 + pick(maxHands)
    const hands: [number, number][] = []
    const ranks: number[] = []
    const seen = new Set<string>()

    while (hands.length < count) {
      const a = pick(52)
      let b = pick(52)
      if (a === b) continue
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`
      if (seen.has(key)) continue
      seen.add(key)
      hands.push([a, b])
      // A small rank spread forces plenty of ties, which is where the sweep
      // is most likely to go wrong.
      ranks.push(rankFor(a, b))
    }

    const reach = new Float64Array(hands.length)
    for (let i = 0; i < reach.length; i++) reach[i] = rng()

    return { set: makeHandSet(hands, ranks), reach }
  }

  return { hero: makeSide(), villain: makeSide() }
}

describe('showdown values', () => {
  it('matches the naive reference across many random spots', () => {
    const rng = makeRng(20260918)
    let worst = 0

    for (let trial = 0; trial < 400; trial++) {
      // Vary the rank spread so some trials are almost all ties and others
      // almost all distinct.
      const spread = 1 + (trial % 12)
      const { hero, villain } = randomCase(rng, 24, spread)
      const atRisk = 1 + rng() * 50

      const fast = new Float64Array(hero.set.count)
      const slow = new Float64Array(hero.set.count)
      showdownValues(hero.set, villain.set, villain.reach, atRisk, fast)
      showdownValuesNaive(hero.set, villain.set, villain.reach, atRisk, slow)

      for (let i = 0; i < hero.set.count; i++) {
        const diff = Math.abs(fast[i] - slow[i])
        worst = Math.max(worst, diff)
        expect(
          diff,
          `trial ${trial} hand ${i}: fast=${fast[i]} naive=${slow[i]}`
        ).toBeLessThan(1e-9)
      }
    }

    expect(worst).toBeLessThan(1e-9)
  })

  it('matches when every hand ties', () => {
    const hero = makeHandSet([[0, 1], [2, 3], [4, 5]], [7, 7, 7])
    const villain = makeHandSet([[6, 7], [8, 9], [0, 10]], [7, 7, 7])
    const reach = Float64Array.from([0.3, 0.5, 0.2])

    const fast = new Float64Array(hero.count)
    const slow = new Float64Array(hero.count)
    showdownValues(hero, villain, reach, 10, fast)
    showdownValuesNaive(hero, villain, reach, 10, slow)

    expect(Array.from(fast)).toEqual(Array.from(slow))
    // All ties means nothing changes hands.
    for (const v of fast) expect(v).toBeCloseTo(0, 12)
  })

  it('accounts for card blocking rather than ignoring it', () => {
    // Hero holds card 0; villain's only hand also uses card 0, so they can
    // never be up against each other and the value must be exactly zero.
    const hero = makeHandSet([[0, 1]], [10])
    const villain = makeHandSet([[0, 2]], [1])
    const reach = Float64Array.from([1])

    const fast = new Float64Array(1)
    showdownValues(hero, villain, reach, 10, fast)
    expect(fast[0]).toBe(0)
  })

  it('both ranges holding the same cards cancels without a correction term', () => {
    // Both sides enumerate their range independently, so the same holding
    // appears in both. It can never be dealt to both players, and because the
    // same cards on the same board score identically it ties itself - which is
    // what lets the per-card subtractions cancel with no add-back.
    const hero = makeHandSet([[3, 9], [20, 21]], [5, 8])
    const villain = makeHandSet([[3, 9], [30, 31]], [5, 2])
    const reach = Float64Array.from([0.4, 0.6])

    const fast = new Float64Array(hero.count)
    const slow = new Float64Array(hero.count)
    showdownValues(hero, villain, reach, 10, fast)
    showdownValuesNaive(hero, villain, reach, 10, slow)

    for (let i = 0; i < hero.count; i++) {
      expect(fast[i]).toBeCloseTo(slow[i], 12)
    }
  })

  it('folds: matches the naive reference, including the double-counted holding', () => {
    const rng = makeRng(777)
    for (let trial = 0; trial < 200; trial++) {
      const { hero, villain } = randomCase(rng, 20, 5)
      const amount = 1 + rng() * 20

      const fast = new Float64Array(hero.set.count)
      const slow = new Float64Array(hero.set.count)
      foldValues(hero.set, villain.set, villain.reach, amount, fast)
      foldValuesNaive(hero.set, villain.set, villain.reach, amount, slow)

      for (let i = 0; i < hero.set.count; i++) {
        expect(
          Math.abs(fast[i] - slow[i]),
          `trial ${trial} hand ${i}: fast=${fast[i]} naive=${slow[i]}`
        ).toBeLessThan(1e-9)
      }
    }
  })

  it('folds: hero holding the same cards as a villain hand is not over-subtracted', () => {
    // The exact overlap case the inclusion-exclusion term exists for.
    const hero = makeHandSet([[3, 9]], [0])
    const villain = makeHandSet([[3, 9], [20, 21]], [0, 0])
    const reach = Float64Array.from([0.4, 0.6])

    const fast = new Float64Array(1)
    const slow = new Float64Array(1)
    foldValues(hero, villain, reach, 10, fast)
    foldValuesNaive(hero, villain, reach, 10, slow)

    expect(fast[0]).toBeCloseTo(slow[0], 12)
    // Only the non-overlapping villain hand can be there.
    expect(fast[0]).toBeCloseTo(10 * 0.6, 12)
  })
})
