import { describe, it, expect, beforeAll } from 'vitest'
import { Range } from '../../engine/range'
import { stringToCard } from '../../engine/cards'
import { CFRSolver } from '../cfr'
import { createInitialNode } from '../game-tree'

// The river is the one street this solver currently gets right, so it is the
// reference every later change is measured against. A river solve has no
// runouts left to deal, which keeps the tree small enough to actually converge
// (~2.5k info sets, ~37 regret updates each at 20k iterations).
//
// These assertions are about ORDERING WITH MARGIN, not exact frequencies - the
// point is to catch a change that breaks the solver's grasp of hand strength,
// not to freeze specific numbers that legitimate improvements would shift. The
// seed makes runs reproducible so a failure means a real change.

const SEED = 12345
const ITERATIONS = 20000

const BTN = 'AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo'
const BB =
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'

// Ks 9h 4c 2d 7s - a dry board with no flush or straight completed.
const BOARD = ['Ks', '9h', '4c', '2d', '7s'].map(stringToCard)

describe('river solve (ground-truth fixture)', () => {
  let solver: CFRSolver
  const bbRange = Range.fromString(BB)

  // Aggression = how often this hand does anything other than check.
  const aggression = (combo: string): number => {
    const strategy = solver.getRangeStrategy(Range.fromString(combo), BOARD)
    if (strategy.size === 0) throw new Error(`${combo} was never sampled`)
    return 1 - (strategy.get('check') ?? 0)
  }

  beforeAll(() => {
    solver = new CFRSolver(SEED)
    solver.solve(createInitialNode(100, 10, BOARD), [Range.fromString(BTN), bbRange], BOARD, ITERATIONS)
  })

  it('is sampled well enough for the strategy to mean anything', () => {
    const stats = solver.getCoverageStats()
    expect(stats.infoSets).toBeGreaterThan(500)
    // This solve measures at median 9, against median 1 for the flop solve that
    // produces noise. The gate sits between the two: it catches a regression
    // that starves the river, without pinning the exact figure.
    expect(stats.medianVisits).toBeGreaterThanOrEqual(5)
  })

  it('produces a valid probability distribution at the root', () => {
    const strategy = solver.getRangeStrategy(bbRange, BOARD)
    const total = [...strategy.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 5)
    for (const p of strategy.values()) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('bets strong hands more often than weak ones', () => {
    // KK is top set here; 55 is an underpair to four board cards.
    expect(aggression('KK')).toBeGreaterThan(aggression('55') + 0.2)
  })

  it('checks a busted overcard hand more often than it checks top set', () => {
    // AQo missed everything on Ks9h4c2d7s.
    expect(aggression('AQo')).toBeLessThan(aggression('KK'))
  })

  it('is deterministic for a given seed', () => {
    const second = new CFRSolver(SEED)
    second.solve(createInitialNode(100, 10, BOARD), [Range.fromString(BTN), bbRange], BOARD, ITERATIONS)

    const a = solver.getRangeStrategy(bbRange, BOARD)
    const b = second.getRangeStrategy(bbRange, BOARD)

    expect([...b.keys()].sort()).toEqual([...a.keys()].sort())
    for (const [action, prob] of a) {
      expect(b.get(action)).toBeCloseTo(prob, 10)
    }
  })
})
