import { describe, it, expect } from 'vitest'
import { stringToCard } from '../../engine/cards'
import { Range } from '../../engine/range'
import { CHANCE, TERMINAL } from '../public-tree'
import { VectorCFR } from '../vector-cfr'

// What a flop solve actually costs, and whether it stays sound over one.
//
// The flop is what the whole rewrite is for, and it is also where every part
// of the machinery is exercised at once: two chance nodes, the runout
// corrections compounding, holdings dropping out as cards are dealt. This does
// not assert anything about the strategy - a few hundred iterations is nowhere
// near converged, and asserting on an unconverged strategy would just freeze
// noise. It asserts the invariants, and reports the numbers.

const BTN = 'AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo'
const BB =
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
const FLOP = ['Ks', '9h', '4c'].map(stringToCard)

const ITERATIONS = 200

describe('flop solve', () => {
  it('stays inside a sane memory budget, and says what it used', () => {
    const heapBefore = process.memoryUsage().heapUsed

    const buildStart = Date.now()
    const solver = new VectorCFR({
      stack: 100,
      pot: 10,
      board: FLOP,
      ranges: [Range.fromString(BTN), Range.fromString(BB)],
      seed: 12345,
    })
    const buildSeconds = (Date.now() - buildStart) / 1000

    let peakHeap = process.memoryUsage().heapUsed
    const runStart = Date.now()
    for (let chunk = 0; chunk < 10; chunk++) {
      solver.run(ITERATIONS / 10)
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
    }
    const runSeconds = (Date.now() - runStart) / 1000

    const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
    console.log(
      `      flop: ${solver.tree.nodeCount} nodes, ${solver.infoSetCount} info sets ` +
        `(node x holding), ${solver.slotCount} regret slots\n` +
        `      build ${buildSeconds.toFixed(2)}s, ` +
        `${((runSeconds / ITERATIONS) * 1000).toFixed(1)}ms/iteration over ${ITERATIONS}\n` +
        `      solver arrays ${mib(solver.bytes())} MiB, ` +
        `peak process heap ${mib(peakHeap)} MiB (${mib(heapBefore)} MiB before)`
    )

    // The gate: a flop solve has to stay well clear of a browser tab's budget.
    // This is the whole process, so it is an over-count of the solver's own
    // share, which is the right way round for a limit.
    expect(peakHeap).toBeLessThan(500 * 1024 * 1024)
  })

  it('keeps the root zero-sum with two chance nodes in the way', () => {
    const solver = new VectorCFR({
      stack: 100,
      pot: 10,
      board: FLOP,
      ranges: [Range.fromString(BTN), Range.fromString(BB)],
      seed: 999,
    })
    solver.run(20)

    // Each chance node scales both players' values by the same correction and
    // kills the same deals for both, so this survives them. It is the cheapest
    // check that the corrections did not go on one side only.
    const [value0, value1] = solver.rootValues()
    const scale = Math.max(Math.abs(value0), Math.abs(value1))
    console.log(`      flop root values ${value0.toFixed(4)} / ${value1.toFixed(4)}`)
    expect(scale).toBeGreaterThan(1)
    expect(Math.abs(value0 + value1) / scale).toBeLessThan(1e-12)
  })

  it('gives every holding a valid distribution at every decision node', () => {
    const solver = new VectorCFR({
      stack: 100,
      pot: 10,
      board: FLOP,
      ranges: [Range.fromString(BTN), Range.fromString(BB)],
      seed: 999,
    })
    solver.run(20)

    const tree = solver.tree
    let checked = 0
    for (let node = 0; node < tree.nodeCount; node++) {
      const player = tree.player[node]
      if (player === CHANCE || player === TERMINAL) continue
      for (let hand = 0; hand < solver.hands[player].count; hand++) {
        const strategy = solver.averageStrategy(node, hand)
        let total = 0
        for (const p of strategy) {
          expect(p).toBeGreaterThanOrEqual(0)
          total += p
        }
        expect(total, `node ${node} hand ${hand}`).toBeCloseTo(1, 12)
        checked++
      }
    }
    expect(checked).toBe(solver.infoSetCount)
  })
})
