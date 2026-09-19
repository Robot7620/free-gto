import { describe, it, expect } from 'vitest'
import { Card, cardToNumber, createDeck, stringToCard } from '../../engine/cards'
import { evaluateHand } from '../../engine/evaluator'
import { Range } from '../../engine/range'
import {
  GameNode,
  TreeConfig,
  createInitialNode,
  applyAction,
  advanceStreet,
} from '../game-tree'
import { chanceChildFor, CHANCE, TERMINAL } from '../public-tree'
import { runoutClass } from '../runout-class'
import { VectorCFR } from '../vector-cfr'

// The vectorized solver computes a whole range's counterfactual values in one
// sweep, with card removal, runout sampling and a per-street correction folded
// together. All of that is easy to get plausibly wrong, so this checks it
// against the only thing that is obviously right: deal two specific holdings,
// enumerate every runout that can still come, and average.
//
// The reference walks the live recursive game tree from game-tree.ts, reading
// the strategy out of the solver but doing all the arithmetic itself. It shares
// no code with the sweep in showdown-values.ts or with the traversal.

const TINY: TreeConfig = {
  betFractions: [['bet50', 0.5]],
  maxAggressiveActions: 1,
}

// Value of one dealt hand pair to `hero`, under the strategy the solver is
// currently playing, averaging over every legal runout at each chance node.
function naiveValue(
  node: GameNode,
  publicNode: number,
  solver: VectorCFR,
  hands: [[Card, Card], [Card, Card]],
  handIndex: [number, number],
  hero: number,
  strategyOf: (node: number, hand: number) => Float64Array
): number {
  const tree = solver.tree

  if (node.isTerminal) {
    expect(tree.player[publicNode]).toBe(TERMINAL)
    if (node.payoff) return node.payoff[hero]

    const value0 = evaluateHand([...hands[0], ...node.board]).value
    const value1 = evaluateHand([...hands[1], ...node.board]).value
    if (value0 === value1) return 0
    const atRisk = Math.min(node.contributed[0], node.contributed[1])
    return (value0 > value1) === (hero === 0) ? atRisk : -atRisk
  }

  if (node.isChance) {
    expect(tree.player[publicNode]).toBe(CHANCE)
    // The cards that can still come: neither on the board nor in either hand.
    const used = new Set(
      [...node.board, ...hands[0], ...hands[1]].map(cardToNumber)
    )
    const available = createDeck().filter(c => !used.has(cardToNumber(c)))

    let total = 0
    for (const card of available) {
      total += naiveValue(
        advanceStreet(node, card),
        chanceChildFor(tree, publicNode, runoutClass(card, node.board, tree.classCount)),
        solver,
        hands,
        handIndex,
        hero,
        strategyOf
      )
    }
    return total / available.length
  }

  expect(tree.player[publicNode]).toBe(node.player)
  const strategy = strategyOf(publicNode, handIndex[node.player])
  const start = tree.actionStart[publicNode]

  let total = 0
  node.actions.forEach((action, a) => {
    expect(tree.actions[start + a]).toBe(action)
    if (strategy[a] === 0) return
    total +=
      strategy[a] *
      naiveValue(
        applyAction(node, action),
        tree.children[start + a],
        solver,
        hands,
        handIndex,
        hero,
        strategyOf
      )
  })
  return total
}

// Counterfactual value of each of hero's holdings: the reach-weighted sum over
// every villain holding that does not share a card.
function naiveCounterfactualValues(
  solver: VectorCFR,
  stack: number,
  pot: number,
  board: Card[],
  config: TreeConfig,
  hero: number
): Float64Array {
  const heroHands = solver.hands[hero]
  const villainHands = solver.hands[1 - hero]

  const cache = new Map<string, Float64Array>()
  const strategyOf = (node: number, hand: number): Float64Array => {
    const key = `${node}:${hand}`
    let value = cache.get(key)
    if (value === undefined) {
      value = solver.currentStrategy(node, hand)
      cache.set(key, value)
    }
    return value
  }

  const out = new Float64Array(heroHands.count)
  const root = createInitialNode(stack, pot, board, config)

  for (let h = 0; h < heroHands.count; h++) {
    const heroCards = heroHands.cards[h]
    const heroNums = heroCards.map(cardToNumber)
    let total = 0

    for (let g = 0; g < villainHands.count; g++) {
      const villainCards = villainHands.cards[g]
      const villainNums = villainCards.map(cardToNumber)
      if (villainNums.some(n => heroNums.includes(n))) continue

      const hands: [[Card, Card], [Card, Card]] =
        hero === 0 ? [heroCards, villainCards] : [villainCards, heroCards]
      const handIndex: [number, number] = hero === 0 ? [h, g] : [g, h]

      total +=
        villainHands.weight[g] *
        naiveValue(root, 0, solver, hands, handIndex, hero, strategyOf)
    }

    out[h] = total
  }

  return out
}

// Average the solver's own traversal over every runout it could have sampled.
// Ordered, not unordered: which card arrives first decides which holdings are
// still live during turn betting, so the two orders are different traversals
// and only the ordered average is the expectation the solver is estimating.
function averagedValues(solver: VectorCFR, board: Card[]): [Float64Array, Float64Array] {
  const onBoard = new Set(board.map(cardToNumber))
  const deck = createDeck().filter(c => !onBoard.has(cardToNumber(c)))
  const needed = 5 - board.length

  const totals: [Float64Array, Float64Array] = [
    new Float64Array(solver.hands[0].count),
    new Float64Array(solver.hands[1].count),
  ]
  let count = 0

  const visit = (runout: Card[]) => {
    if (runout.length === needed) {
      const values = solver.valuesForRunout(runout)
      for (const player of [0, 1]) {
        const from = values[player]
        const into = totals[player]
        for (let h = 0; h < from.length; h++) into[h] += from[h]
      }
      count++
      return
    }
    for (const card of deck) {
      if (runout.some(c => cardToNumber(c) === cardToNumber(card))) continue
      runout.push(card)
      visit(runout)
      runout.pop()
    }
  }
  visit([])

  for (const player of [0, 1]) {
    for (let h = 0; h < totals[player].length; h++) totals[player][h] /= count
  }
  return totals
}

function compare(label: string, fast: Float64Array, reference: Float64Array): void {
  expect(fast.length).toBe(reference.length)
  let worst = 0
  let scale = 0
  for (let h = 0; h < fast.length; h++) {
    worst = Math.max(worst, Math.abs(fast[h] - reference[h]))
    scale = Math.max(scale, Math.abs(reference[h]))
  }
  console.log(`      ${label}: worst error ${worst.toExponential(2)} over values up to ${scale.toFixed(3)}`)
  for (let h = 0; h < fast.length; h++) {
    expect(fast[h], `${label} hand ${h}`).toBeCloseTo(reference[h], 9)
  }
}

// Small ranges, but not trivial ones: both sides hold AKs, so the blocking
// terms carry real weight rather than quietly cancelling. The reference is
// quadratic in the ranges and enumerates every runout on top of that, so the
// flop case - 45 x 44 runouts per hand pair - gets the shorter list.
const HERO_RANGE = '99,AKs,76s'
const VILLAIN_RANGE = 'KK,AKs,54s'
const HERO_RANGE_FLOP = '99,AKs'
const VILLAIN_RANGE_FLOP = 'KK,AKs'

function spot(board: Card[], iterations: number, ranges: [string, string]): VectorCFR {
  const solver = new VectorCFR({
    stack: 20,
    pot: 10,
    board,
    ranges: [Range.fromString(ranges[0]), Range.fromString(ranges[1])],
    config: TINY,
    seed: 4242,
  })
  // Run first, so the comparison is against a strategy with structure in it
  // rather than the uniform one every node starts at.
  solver.run(iterations)
  return solver
}

describe('vectorized counterfactual values against a per-deal reference', () => {
  it('agrees on a river, where there is no runout left to average over', () => {
    const board = ['Ks', '9h', '4c', '2d', '7s'].map(stringToCard)
    const solver = spot(board, 50, [HERO_RANGE, VILLAIN_RANGE])
    const averaged = averagedValues(solver, board)

    for (const player of [0, 1]) {
      const reference = naiveCounterfactualValues(solver, 20, 10, board, TINY, player)
      compare(`river player ${player}`, averaged[player], reference)
    }
  })

  it('agrees on a turn, averaged over every river card', () => {
    const board = ['Ks', '9h', '4c', '2d'].map(stringToCard)
    const solver = spot(board, 50, [HERO_RANGE, VILLAIN_RANGE])
    const averaged = averagedValues(solver, board)

    for (const player of [0, 1]) {
      const reference = naiveCounterfactualValues(solver, 20, 10, board, TINY, player)
      compare(`turn player ${player}`, averaged[player], reference)
    }
  })

  it('agrees on a flop, where two chance corrections compound', () => {
    const board = ['Ks', '9h', '4c'].map(stringToCard)
    const solver = spot(board, 50, [HERO_RANGE_FLOP, VILLAIN_RANGE_FLOP])
    const averaged = averagedValues(solver, board)

    for (const player of [0, 1]) {
      const reference = naiveCounterfactualValues(solver, 20, 10, board, TINY, player)
      compare(`flop player ${player}`, averaged[player], reference)
    }
  })
})
