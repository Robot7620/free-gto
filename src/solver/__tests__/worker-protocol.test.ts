import { describe, it, expect } from 'vitest'
import { Range } from '../../engine/range'
import { cardToString, stringToCard } from '../../engine/cards'
import { VectorCFR } from '../vector-cfr'
import {
  deserializeBoard,
  deserializeRange,
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
