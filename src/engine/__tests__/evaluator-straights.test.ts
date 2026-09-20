import { describe, it, expect } from 'vitest'
import { stringToCard } from '../cards'
import { evaluateHand, HandRank } from '../evaluator'

// The ace sits at the top of the rank order, so the descending scan cannot see
// A-2-3-4-5 and the wheel needs its own check. That check used to run first,
// which meant a hand holding the wheel *and* a higher straight scored as the
// wheel. Seven cards leave room for both, so this was reachable in real play.

const hand = (cards: string[]) => evaluateHand(cards.map(stringToCard))
const high = (cards: string[]) => (hand(cards).value >>> 16) & 0xf

// Rank enum: Two=0 ... Ace=12. So Five=3, Six=4, Seven=5.
describe('straight detection', () => {
  it('prefers the higher straight when a wheel is also present', () => {
    expect(high(['Ac', '2d', '3h', '4s', '5c', '6d', 'Kh'])).toBe(4) // six-high
    expect(high(['Ac', '2d', '3h', '4s', '5c', '6d', '7h'])).toBe(5) // seven-high
  })

  it('still finds the wheel when it is the only straight', () => {
    const cards = ['Ac', '2d', '3h', '4s', '5c', 'Kh', 'Qd']
    expect(hand(cards).rank).toBe(HandRank.Straight)
    expect(high(cards)).toBe(3) // five-high
  })

  it('scores a wheel-plus-six identically to the same straight without the ace', () => {
    expect(hand(['Ac', '2d', '3h', '4s', '5c', '6d', 'Kh']).value).toBe(
      hand(['2d', '3h', '4s', '5c', '6d', 'Kh', 'Qs']).value
    )
  })

  it('ranks the wheel below every higher straight', () => {
    const wheel = hand(['Ac', '2d', '3h', '4s', '5c', 'Kh', 'Qd']).value
    const six = hand(['2d', '3h', '4s', '5c', '6d', 'Kh', 'Qs']).value
    const broadway = hand(['Ac', 'Kd', 'Qh', 'Js', 'Tc', '3d', '2s']).value
    expect(wheel).toBeLessThan(six)
    expect(six).toBeLessThan(broadway)
  })

  it('does not invent a straight from four cards to a gap', () => {
    expect(hand(['Ac', '2d', '3h', '4s', '9c', 'Kh', 'Qd']).rank).not.toBe(HandRank.Straight)
  })
})
