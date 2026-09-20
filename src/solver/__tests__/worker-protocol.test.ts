import { describe, it, expect } from 'vitest'
import { Range } from '../../engine/range'
import { cardToString, stringToCard } from '../../engine/cards'
import { VectorCFR } from '../vector-cfr'
import {
  CHUNK_MS,
  PROBE_ITERATIONS,
  deserializeBoard,
  deserializeRange,
  nextChunk,
  serializeBoard,
  serializeRange,
} from '../worker-protocol'

// The worker boundary is structured clone, which silently turns a Range into
// an object with no methods and a Card into a bare pair of numbers. Nothing
// throws when that happens - the solve just runs on a range that is empty, or
// on a board that is not the one the user picked. So the round trip is pinned
// rather than assumed, and pinned by solving through it: two solvers on the
// same seed, one built from the objects and one from what came back over the
// wire, have to agree exactly.

const BTN = Range.fromString('AA,KK,QQ,AKs,AQs,AKo')
const BB = Range.fromString('AA,KK,QQ,JJ,TT,AKs,AQs,KQs,AKo')

describe('worker protocol', () => {
  it('round-trips a range, fractional weights included', () => {
    const range = Range.fromString('AA,KK,AQo')
    range.setWeight('AQo', 0.35)

    const back = deserializeRange(serializeRange(range))

    expect(back.getCombos().sort()).toEqual(range.getCombos().sort())
    expect(back.getWeight('AQo')).toBe(0.35)
    expect(back.getWeight('AA')).toBe(1)
    expect(back.getTotalCombos()).toBeCloseTo(range.getTotalCombos(), 12)
  })

  it('round-trips a board, suits included', () => {
    const board = ['Ks', '9h', '4c', '2d', '7s'].map(stringToCard)
    const back = deserializeBoard(serializeBoard(board))
    expect(back.map(cardToString)).toEqual(['Ks', '9h', '4c', '2d', '7s'])
  })

  it('solves to the same strategy either side of the wire', () => {
    const board = ['Ks', '9h', '4c', '2d', '7s'].map(stringToCard)

    const direct = new VectorCFR({
      stack: 100,
      pot: 10,
      board,
      ranges: [BTN, BB],
      seed: 4242,
    })

    const overTheWire = new VectorCFR({
      stack: 100,
      pot: 10,
      board: deserializeBoard(serializeBoard(board)),
      ranges: [deserializeRange(serializeRange(BTN)), deserializeRange(serializeRange(BB))],
      seed: 4242,
    })

    direct.run(200)
    overTheWire.run(200)

    const root = direct.nodeFor([])
    expect(overTheWire.nodeFor([])).toBe(root)
    expect(Object.fromEntries(overTheWire.aggregateStrategy(root))).toEqual(
      Object.fromEntries(direct.aggregateStrategy(root))
    )
    expect(overTheWire.exploitability().percentOfPot).toBe(
      direct.exploitability().percentOfPot
    )
  })
})

// The loop that spends the time budget, tested away from the Worker it runs
// in. Going through a real Worker would exercise it only at whatever rate the
// machine happens to produce, which is exactly the input that decides whether
// the arithmetic holds.
describe('chunk sizing', () => {
  it('never divides by a rate it has not measured', () => {
    expect(nextChunk(0, 0, 10_000)).toBe(PROBE_ITERATIONS)
    // The one that would wedge the thread: the probe finished inside Date.now's
    // millisecond, so the measured rate is zero and the naive form asks the
    // solver for Infinity iterations.
    expect(nextChunk(0, PROBE_ITERATIONS, 10_000)).toBe(PROBE_ITERATIONS)
    expect(Number.isFinite(nextChunk(0, 1000, 10_000))).toBe(true)
  })

  it('aims each chunk at CHUNK_MS once it has a rate', () => {
    // 19 ms an iteration, the measured flop rate.
    expect(nextChunk(190, 10, 60_000)).toBe(Math.round(CHUNK_MS / 19))
    // 0.6 ms an iteration, the measured river rate.
    expect(nextChunk(600, 1000, 60_000)).toBe(Math.round(CHUNK_MS / 0.6))
  })

  it('clamps to what is left of the budget', () => {
    // 19 ms an iteration with 100 ms left: five fit, not the eight it wants.
    expect(nextChunk(190, 10, 100)).toBe(5)
  })

  it('never returns less than one', () => {
    // Less budget left than a single flop iteration costs. Running it overruns
    // by a few ms; refusing to run it returns an untouched tree.
    expect(nextChunk(1900, 100, 5)).toBe(1)
  })
})
