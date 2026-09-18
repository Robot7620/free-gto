import { describe, it, expect } from 'vitest'
import { stringToCard, cardToNumber } from '../../engine/cards'
import { evaluateHand } from '../../engine/evaluator'
import {
  buildShowdownTable,
  handIndex,
  tableBytes,
  CONFLICT,
} from '../showdown-table'

const FLOP = ['Ks', '9h', '4c'].map(stringToCard)
const TURN = ['Ks', '9h', '4c', '2d'].map(stringToCard)
const RIVER = ['Ks', '9h', '4c', '2d', '7s'].map(stringToCard)

describe('showdown table', () => {
  it('covers every holding and every runout', () => {
    const river = buildShowdownTable(RIVER)
    // 47 cards left, C(47,2) holdings, and nothing left to deal.
    expect(river.handCount).toBe((47 * 46) / 2)
    expect(river.runoutCount).toBe(1)

    const turn = buildShowdownTable(TURN)
    expect(turn.handCount).toBe((48 * 47) / 2)
    expect(turn.runoutCount).toBe(48)

    const flop = buildShowdownTable(FLOP)
    expect(flop.handCount).toBe((49 * 48) / 2)
    // Turn and river together, unordered.
    expect(flop.runoutCount).toBe((49 * 48) / 2)
  })

  it('agrees with evaluateHand directly', () => {
    const table = buildShowdownTable(FLOP)

    // Spot-check across the table rather than all 1.4M entries.
    let checked = 0
    for (let r = 0; r < table.runoutCount; r += 97) {
      for (let h = 0; h < table.handCount; h += 89) {
        const stored = table.ranks[r * table.handCount + h]
        const hand = table.hands[h]
        const runout = table.runouts[r]

        const shares = runout.some(
          c => cardToNumber(c) === cardToNumber(hand[0]) || cardToNumber(c) === cardToNumber(hand[1])
        )

        if (shares) {
          expect(stored).toBe(CONFLICT)
        } else {
          expect(stored).toBe(evaluateHand([...hand, ...FLOP, ...runout]).value)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('ranks a known hand ordering correctly', () => {
    const table = buildShowdownTable(RIVER)
    const rank = (a: string, b: string) => {
      const i = handIndex(table, stringToCard(a), stringToCard(b))
      expect(i).toBeGreaterThanOrEqual(0)
      return table.ranks[i]
    }

    // Board Ks 9h 4c 2d 7s.
    const topSet = rank('Kd', 'Kh') // set of kings
    const overpair = rank('Ad', 'Ah') // aces
    const topPair = rank('Ac', 'Kc') // pair of kings, ace kicker
    const underpair = rank('5d', '5h') // fives
    const air = rank('Qd', 'Jh') // queen high

    expect(topSet).toBeGreaterThan(overpair)
    expect(overpair).toBeGreaterThan(topPair)
    expect(topPair).toBeGreaterThan(underpair)
    expect(underpair).toBeGreaterThan(air)
  })

  it('marks blocked holdings rather than scoring them', () => {
    const table = buildShowdownTable(FLOP)
    // Find a runout and a hand that share a card.
    const runoutIdx = 0
    const runout = table.runouts[runoutIdx]
    const blocked = table.hands.findIndex(h =>
      runout.some(c => cardToNumber(c) === cardToNumber(h[0]))
    )
    expect(blocked).toBeGreaterThanOrEqual(0)
    expect(table.ranks[runoutIdx * table.handCount + blocked]).toBe(CONFLICT)
  })

  it('fits in memory for a flop', () => {
    const t0 = Date.now()
    const table = buildShowdownTable(FLOP)
    const secs = (Date.now() - t0) / 1000
    console.log(
      `      flop showdown table: ${table.runoutCount} runouts x ${table.handCount} hands, ` +
        `${(tableBytes(table) / 1024 / 1024).toFixed(1)} MiB, built in ${secs.toFixed(1)}s`
    )
    expect(tableBytes(table)).toBeLessThan(16 * 1024 * 1024)
  })
})
