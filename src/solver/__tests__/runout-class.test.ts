import { describe, it, expect } from 'vitest'
import { createDeck, stringToCard, cardToString, cardToNumber } from '../../engine/cards'
import {
  runoutClass,
  coarsenClass,
  classNames,
  PAIR,
  FLUSH,
  OVERCARD,
  BRICK,
} from '../runout-class'

const cards = (s: string) => s.split(' ').map(stringToCard)

// Every card that can still be dealt on a board.
const remaining = (board: string) => {
  const used = new Set(cards(board).map(cardToNumber))
  return createDeck().filter(c => !used.has(cardToNumber(c)))
}

describe('runout classes', () => {
  it('puts every card in exactly one class, at every supported K', () => {
    for (const board of ['Ks 9h 4c', 'Ks 9s 4c', 'Ah Kh Qh', '7c 7d 2s', 'Ks 9h 4c 2d']) {
      for (const k of [1, 4, 8]) {
        for (const card of remaining(board)) {
          const c = runoutClass(card, cards(board), k)
          expect(Number.isInteger(c), `${cardToString(card)} on ${board} at K=${k}`).toBe(true)
          expect(c).toBeGreaterThanOrEqual(0)
          expect(c).toBeLessThan(k)
        }
      }
    }
  })

  it('collapses to a single class at K=1, which is the old unclassed tree', () => {
    for (const card of remaining('Ks 9h 4c')) {
      expect(runoutClass(card, cards('Ks 9h 4c'), 1)).toBe(0)
    }
  })

  it('classes the four kinds on a two-tone board', () => {
    const board = cards('Ks 9s 4c')
    const at = (s: string) => runoutClass(stringToCard(s), board, 4)

    expect(at('Kd'), 'pairs the top card').toBe(PAIR)
    expect(at('9d'), 'pairs the middle card').toBe(PAIR)
    expect(at('4h'), 'pairs the bottom card').toBe(PAIR)
    expect(at('2s'), 'third spade').toBe(FLUSH)
    expect(at('Ad'), 'ace over the king').toBe(OVERCARD)
    expect(at('7d'), 'under the king, no suit, no pair').toBe(BRICK)
  })

  it('files a card that both pairs and brings a flush under the pair', () => {
    // Ks 9s 4c: the 9s pairs the nine AND makes three spades. The pair is the
    // more violent thing it did, and the precedence has to be deterministic
    // or the same card would route two ways.
    expect(runoutClass(stringToCard('9s'), cards('Ks 9s 4c'), 4)).toBe(PAIR)
  })

  it('never calls a card an overcard when it pairs the board', () => {
    // An ace on an ace-high board pairs; it is not "over" anything.
    expect(runoutClass(stringToCard('Ad'), cards('Ah Kh 4c'), 4)).toBe(PAIR)
  })

  it('needs two of a suit on the board before a third counts as a flush card', () => {
    // Rainbow: no card can bring a flush, so that class is simply unreachable
    // here - which is a fact about the board, not a bug.
    const board = cards('Ks 9h 4c')
    for (const card of remaining('Ks 9h 4c')) {
      if (runoutClass(card, board, 4) === FLUSH) {
        throw new Error(`${cardToString(card)} called a flush card on a rainbow board`)
      }
    }
  })

  it('classes against the board as it stands, so a river can pair the turn', () => {
    // 2d is a brick on the flop and the 2h that follows pairs it.
    expect(runoutClass(stringToCard('2d'), cards('Ks 9h 4c'), 4)).toBe(BRICK)
    expect(runoutClass(stringToCard('2h'), cards('Ks 9h 4c 2d'), 4)).toBe(PAIR)
  })

  it('K=8 is a strict refinement of K=4', () => {
    // Each K=8 class sits inside exactly one K=4 class, which is what makes
    // the two comparable rather than merely different.
    for (const board of ['Ks 9h 4c', 'Ks 9s 4c', 'Ah Kh Qh', '7c 7d 2s', 'Ks 9s 4c 2d']) {
      for (const card of remaining(board)) {
        expect(
          coarsenClass(runoutClass(card, cards(board), 8)),
          `${cardToString(card)} on ${board}`
        ).toBe(runoutClass(card, cards(board), 4))
      }
    }
  })

  it('K=8 separates trips from a low pair, and a made flush from a draw', () => {
    const twoTone = cards('Ks 9s 4c')
    const at8 = (s: string) => runoutClass(stringToCard(s), twoTone, 8)
    expect(at8('Kd'), 'pairs the top card').toBe(0)
    expect(at8('4h'), 'pairs the bottom card').toBe(1)
    expect(at8('2s'), 'only a third spade, no flush yet').toBe(3)

    // Monotone: a fourth heart completes a flush outright.
    expect(runoutClass(stringToCard('2h'), cards('Ah Kh 7h'), 8)).toBe(2)
  })

  it('K=8 tells a connecting brick from a disconnected one', () => {
    // Ks 9h 4c: the king and the nine are four ranks apart, so a ten drops
    // into the window with them and puts a straight in play.
    expect(runoutClass(stringToCard('Td'), cards('Ks 9h 4c'), 8)).toBe(7)
    // A seven reaches the nine but not the four - the four and the nine are
    // six ranks apart, so nothing lands three-in-a-window down there.
    expect(runoutClass(stringToCard('7d'), cards('Ks 9h 4c'), 8)).toBe(6)
    // A deuce pairs nothing and reaches only the four.
    expect(runoutClass(stringToCard('2d'), cards('Ks 9h 4c'), 8)).toBe(6)
  })

  it('counts the ace at both ends for connectedness', () => {
    // A on 2 3 K: A-2-3 is three ranks inside a five-window, using the ace low.
    expect(runoutClass(stringToCard('Ad'), cards('Kc 3h 2s'), 8)).toBe(5)
  })

  it('names every class it can produce', () => {
    for (const k of [1, 4, 8]) expect(classNames(k)).toHaveLength(k)
    expect(() => classNames(3)).toThrow()
    expect(() => runoutClass(stringToCard('2d'), cards('Ks 9h 4c'), 3)).toThrow()
  })
})
