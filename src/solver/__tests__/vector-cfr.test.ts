import { describe, it, expect, beforeAll } from 'vitest'
import { stringToCard } from '../../engine/cards'
import { Range } from '../../engine/range'
import { CHANCE, TERMINAL } from '../public-tree'
import { VectorCFR } from '../vector-cfr'

// A river spot, solved the vectorized way.
//
// A river solve is the correctness gate for this solver because it has no
// runouts left to deal: the K=1 runout abstraction - regrets keyed on a public
// tree node that does not record which card fell - has nothing to abstract, so
// the solve is exact within the betting abstraction. Anything wrong here is
// wrong in the machinery, not in the abstraction.

const SEED = 12345
const ITERATIONS = 4000

const BTN = 'AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo'
const BB =
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'

const BOARD = ['Ks', '9h', '4c', '2d', '7s'].map(stringToCard)

const solve = (iterations: number, seed: number = SEED): VectorCFR => {
  const solver = new VectorCFR({
    stack: 100,
    pot: 10,
    board: BOARD,
    ranges: [Range.fromString(BTN), Range.fromString(BB)],
    seed,
  })
  solver.run(iterations)
  return solver
}

// One solve, shared by both blocks below - it is the expensive part of this
// file and nothing here mutates it.
let shared: VectorCFR | undefined
const solved = (): VectorCFR => {
  if (!shared) shared = solve(ITERATIONS)
  return shared
}

describe('vectorized river solve', () => {
  let solver: VectorCFR

  beforeAll(() => {
    solver = solved()
  })

  it('gives every holding at every decision node a valid distribution', () => {
    const tree = solver.tree
    let checked = 0

    for (let node = 0; node < tree.nodeCount; node++) {
      const player = tree.player[node]
      if (player === CHANCE || player === TERMINAL) continue

      for (let hand = 0; hand < solver.hands[player].count; hand++) {
        const average = solver.averageStrategy(node, hand)
        const current = solver.currentStrategy(node, hand)
        expect(average.length).toBe(tree.actionCount[node])

        for (const strategy of [average, current]) {
          let total = 0
          for (const p of strategy) {
            expect(p).toBeGreaterThanOrEqual(0)
            expect(p).toBeLessThanOrEqual(1)
            total += p
          }
          expect(total, `node ${node} hand ${hand}`).toBeCloseTo(1, 12)
        }
        checked++
      }
    }

    console.log(`      checked ${checked} (node, holding) strategies`)
    expect(checked).toBeGreaterThan(1000)
  })

  it('splits the pot between the two players and nothing else', () => {
    // Every terminal is zero-sum over the holdings that can actually be dealt
    // together, and nothing in the traversal breaks that symmetry - so this is
    // an end-to-end check on the terminal arithmetic, the card removal and the
    // reach bookkeeping at once.
    const [value0, value1] = solver.rootValues()
    const scale = Math.max(Math.abs(value0), Math.abs(value1))
    console.log(
      `      root values ${value0.toFixed(4)} / ${value1.toFixed(4)}, ` +
        `sum ${(value0 + value1).toExponential(2)}`
    )
    expect(scale).toBeGreaterThan(1)
    expect(Math.abs(value0 + value1) / scale).toBeLessThan(1e-12)
  })

  it('is deterministic for a given seed', () => {
    // Short runs: determinism is a property of the sample path, and a
    // divergence shows up on the first iteration that differs, not the last.
    const first = solve(300)
    const second = solve(300)
    const tree = first.tree

    for (let node = 0; node < tree.nodeCount; node++) {
      const player = tree.player[node]
      if (player === CHANCE || player === TERMINAL) continue
      for (let hand = 0; hand < first.hands[player].count; hand++) {
        const a = first.averageStrategy(node, hand)
        const b = second.averageStrategy(node, hand)
        for (let i = 0; i < a.length; i++) {
          expect(b[i], `node ${node} hand ${hand} action ${i}`).toBe(a[i])
        }
      }
    }
  })

  it('bets strong hands more often than weak ones, as the river fixture requires', () => {
    const aggression = (combo: string): number =>
      1 - (solver.aggregateStrategy(0, [combo]).get('check') ?? 0)

    // The two assertions that pinned hand strength for the old sampler
    // solver, so the vectorized one is held to the standard the sampled one
    // already meets.
    expect(aggression('KK')).toBeGreaterThan(aggression('55') + 0.2)
    expect(aggression('AQo')).toBeLessThan(aggression('KK'))
  })
})

describe('runout cards remove the holdings they block', () => {
  // Zeroing a blocked holding's reach keeps it out of every terminal, but on
  // its own it does not stop the traversal computing a value for it and folding
  // that into its regrets on the way back up - and that value would be scored
  // off a CONFLICT rank, i.e. as though the holding were the worst hand
  // possible. Each holding is blocked by roughly 8% of flop runouts, so the
  // mistake would be systematic rather than rare.
  //
  // A turn board makes it observable: the river card is the only thing dealt,
  // so every node past the chance node belongs to the street it opened.
  const TURN = ['Ks', '9h', '4c', '2d'].map(stringToCard)
  const RIVER_CARD = stringToCard('Qh')

  // Checking the strategy here would not do it. Scored as the worst hand
  // possible, a blocked holding gets a negative regret for every action at
  // once, and regret matching flattens an all-negative vector back to uniform -
  // so the corruption is invisible in the strategy and plain in the regrets.
  it('leaves a blocked holding with no accumulated regret past the chance node', () => {
    const solver = new VectorCFR({
      stack: 100,
      pot: 10,
      board: TURN,
      ranges: [Range.fromString(BTN), Range.fromString(BB)],
      seed: SEED,
    })
    // The same card every time, so a holding that does learn has visibly moved
    // off uniform and a blocked one has had every chance to be corrupted.
    for (let i = 0; i < 20; i++) solver.runWithRunout([RIVER_CARD])

    const tree = solver.tree
    let blockedChecked = 0
    let liveMoved = 0

    for (let node = 0; node < tree.nodeCount; node++) {
      const player = tree.player[node]
      if (player === CHANCE || player === TERMINAL) continue
      // Only the street the river card opened. The turn sits above the chance
      // node, where every holding is still live.
      if (tree.street[node] !== 3) continue

      const hands = solver.hands[player]
      for (let hand = 0; hand < hands.count; hand++) {
        const blocked = hands.cards[hand].some(
          card => card.rank === RIVER_CARD.rank && card.suit === RIVER_CARD.suit
        )
        const regrets = solver.regretsAt(node, hand)
        const largest = Math.max(...[...regrets].map(Math.abs))

        if (blocked) {
          expect(largest, `node ${node} hand ${hand} holds the river card`).toBe(0)
          blockedChecked++
        } else if (largest > 1e-6) {
          liveMoved++
        }
      }
    }

    console.log(
      `      ${blockedChecked} blocked (node, holding) pairs untouched, ${liveMoved} live ones learned`
    )
    expect(blockedChecked).toBeGreaterThan(50)
    // Without this the assertion above would also pass on a solver that learns
    // nothing anywhere.
    expect(liveMoved).toBeGreaterThan(100)
  })
})
