import { Card, createDeck, cardToNumber, removeCards } from '../engine/cards'
import { evaluateHand } from '../engine/evaluator'

// Showdown strengths, precomputed for every holding against every way the board
// can run out.
//
// evaluateHand costs ~740ns and the solver calls it at every showdown, every
// iteration. It also backs the bucket cache, which is currently an unbounded
// string-keyed Map - reachable at a few million entries, hundreds of MB, and the
// thing that would kill any long run.
//
// Runouts are unordered: the strength of a five-card board doesn't depend on
// which card arrived first, so the turn/river pair is a combination, not a
// permutation. That halves the work.

export const CONFLICT = -1

export interface ShowdownTable {
  // Every two-card holding available given the board, in a fixed order.
  hands: [Card, Card][]
  // Every way the remaining board can come. One empty entry for a river board.
  runouts: Card[][]
  handCount: number
  runoutCount: number
  // ranks[runout * handCount + hand], or CONFLICT where the holding uses one of
  // the runout's cards.
  ranks: Int32Array
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  const out: T[][] = []
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice())
      return
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i])
      pick(i + 1, acc)
      acc.pop()
    }
  }
  pick(0, [])
  return out
}

export function buildShowdownTable(board: Card[]): ShowdownTable {
  const available = removeCards(createDeck(), board)
  const hands = combinations(available, 2) as [Card, Card][]
  const runouts = combinations(available, 5 - board.length)

  const handCount = hands.length
  const runoutCount = runouts.length
  const ranks = new Int32Array(runoutCount * handCount)

  const handCards = hands.map(([a, b]) => [cardToNumber(a), cardToNumber(b)])

  runouts.forEach((runout, r) => {
    const runoutNums = runout.map(cardToNumber)
    const fullBoard = [...board, ...runout]
    const base = r * handCount

    for (let h = 0; h < handCount; h++) {
      const [c0, c1] = handCards[h]
      let clash = false
      for (const n of runoutNums) {
        if (n === c0 || n === c1) {
          clash = true
          break
        }
      }
      ranks[base + h] = clash
        ? CONFLICT
        : evaluateHand([hands[h][0], hands[h][1], ...fullBoard]).value
    }
  })

  return { hands, runouts, handCount, runoutCount, ranks }
}

// Index of a specific holding, or -1. Order-independent.
export function handIndex(table: ShowdownTable, a: Card, b: Card): number {
  const x = cardToNumber(a)
  const y = cardToNumber(b)
  for (let i = 0; i < table.handCount; i++) {
    const p = cardToNumber(table.hands[i][0])
    const q = cardToNumber(table.hands[i][1])
    if ((p === x && q === y) || (p === y && q === x)) return i
  }
  return -1
}

export function tableBytes(table: ShowdownTable): number {
  return table.ranks.byteLength
}
