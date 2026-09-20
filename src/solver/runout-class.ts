import { Card } from '../engine/cards'

// Which kind of card just fell.
//
// The public tree records the street but not the card, so at K=1 the solver
// plays a flush-completing turn exactly like a brick. Measured at convergence
// that costs 14.4% of pot on a rainbow turn and 17.8% on a two-tone one, 38.6%
// and 51.5% on the corresponding flops, and none of those move with more
// compute - flat from 8k iterations to 80k - because it is the abstraction and
// not the sampling. K=4 takes them to 12.0/12.1% and 33.3/32.9%.
//
// The two-tone columns are the ones to read. K=1 is 3.4 points worse on a
// two-tone turn than a rainbow one and 12.9 worse on a two-tone flop, for
// nothing but a suit it cannot see; K=4 lands within half a point of itself on
// both. That is what these classes are for. See TODO.md for the tables.
//
// Classing the runout buys back the distinction the tree is missing without
// paying for all 47 cards: the chance node gets one successor per class instead
// of one in total, and the solver routes the dealt card to its class. What the
// classes cost is memory and samples-per-slot, not time - a traversal still
// visits exactly one successor per chance node, whatever K is.
//
// Samples-per-slot is the real cost and it is worth being concrete about:
// dividing the updates means K=4 starts BEHIND K=1 and crosses it at roughly
// 2,000-4,000 turn iterations and 5,000 flop ones. Four is still the default
// because K=1's number is a floor and K=4's deficit is a queue. See
// DEFAULT_RUNOUT_CLASSES in vector-cfr.ts for that argument in full.
//
// K=8 was measured too and buys nothing over K=4 at the same iteration count,
// for four times the memory on a flop - where it would also meet four times
// the dilution. Rejected on measurement, not left untried.
//
// The scheme is deliberately about the card's *relationship to the board*, not
// its face value. An offsuit 7 is a brick on one board and the card that pairs
// the turn on another.

export const SUPPORTED_CLASS_COUNTS = [1, 4, 8] as const

// K=4. The order is a precedence, not just a labelling: a card that pairs the
// board AND completes a flush is filed under the pair, because that is the more
// violent thing it did.
export const PAIR = 0
export const FLUSH = 1
export const OVERCARD = 2
export const BRICK = 3

export const CLASS_NAMES_4 = ['pair', 'flush', 'overcard', 'brick']

// K=8 splits each of the four on the distinction that matters most inside it.
export const CLASS_NAMES_8 = [
  'pairs top',
  'pairs lower',
  'completes flush',
  'third of a suit',
  'overcard',
  'overcard, connecting',
  'brick',
  'brick, connecting',
]

export function classNames(classCount: number): string[] {
  if (classCount === 1) return ['any']
  if (classCount === 4) return CLASS_NAMES_4
  if (classCount === 8) return CLASS_NAMES_8
  throw new Error(`no names for K=${classCount}`)
}

// Does the card land in a five-rank window holding three or more distinct
// ranks? That is the shape a straight needs, and it is what separates a 7 on
// T98 from a 7 on K42. The ace counts at both ends, so A on 234 connects.
function connects(card: Card, board: Card[]): boolean {
  const present = new Set<number>()
  const add = (rank: number) => {
    present.add(rank)
    if (rank === 12) present.add(-1)
  }
  for (const b of board) add(b.rank)
  add(card.rank)

  const cardRanks = card.rank === 12 ? [12, -1] : [card.rank]

  for (const r of cardRanks) {
    for (let low = r - 4; low <= r; low++) {
      if (low < -1 || low + 4 > 12) continue
      let count = 0
      for (let x = low; x <= low + 4; x++) if (present.has(x)) count++
      if (count >= 3) return true
    }
  }
  return false
}

// The class of `card` given the board it lands on. The board is the board at
// the moment the card is dealt: for a river card that includes the turn, so a
// river that pairs the turn is a pairing card.
export function runoutClass(card: Card, board: Card[], classCount: number): number {
  if (classCount === 1) return 0

  let topRank = -1
  let pairsBoard = false
  let pairsTop = false
  let suited = 0
  for (const b of board) {
    if (b.rank > topRank) topRank = b.rank
    if (b.rank === card.rank) pairsBoard = true
    if (b.suit === card.suit) suited++
  }
  pairsTop = pairsBoard && card.rank === topRank

  const base = pairsBoard
    ? PAIR
    : suited >= 2
      ? FLUSH
      : card.rank > topRank
        ? OVERCARD
        : BRICK

  if (classCount === 4) return base

  if (classCount === 8) {
    switch (base) {
      // Trips on the board's top card plays nothing like a deuce pairing.
      case PAIR:
        return pairsTop ? 0 : 1
      // A flush is either live now or one card away, and those are opposite
      // spots: one range is drawing, the other is already there.
      case FLUSH:
        return suited >= 3 ? 2 : 3
      case OVERCARD:
        return connects(card, board) ? 5 : 4
      default:
        return connects(card, board) ? 7 : 6
    }
  }

  throw new Error(`unsupported runout class count ${classCount}`)
}

// K=8 is a refinement of K=4: every K=8 class sits inside exactly one K=4
// class. This is what makes the two measurable against each other rather than
// just different.
export function coarsenClass(cls8: number): number {
  return cls8 >> 1
}
