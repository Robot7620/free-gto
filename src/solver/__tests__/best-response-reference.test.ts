import { describe, it, expect } from 'vitest'
import { Card, cardToNumber, createDeck, stringToCard } from '../../engine/cards'
import { evaluateHand } from '../../engine/evaluator'
import { Range } from '../../engine/range'
import { GameNode, TreeConfig, createInitialNode, applyAction, advanceStreet } from '../game-tree'
import { chanceChildFor, CHANCE, TERMINAL } from '../public-tree'
import { runoutClass } from '../runout-class'
import { VectorCFR } from '../vector-cfr'

// The best response, computed a second time by something obviously correct.
//
// `exploitability()` averages the runout inside the walk so that hero chooses
// once above a chance node and freely below it. That is a different traversal
// order from anything else in the solver and it is the number the texture-class
// work is judged on, so it needs a reference that shares no code with it.
//
// This walks the live recursive game tree, enumerates the cards explicitly, and
// does the card-removal arithmetic in the form it is actually defined in - for
// a fixed pair of holdings the runout is uniform over the cards neither of them
// uses, so the average is over the cards not in hero's hand, normalised by the
// n-4 that are legal for each villain holding. The solver instead sums over all
// n cards, kills the holdings each one blocks, and scales the whole vector by
// n/(n-4). Those are the same number and not the same computation.

const TINY: TreeConfig = {
  betFractions: [['bet50', 0.5]],
  maxAggressiveActions: 1,
}

const BTN = Range.fromString('AA,KK,AKs')
const BB = Range.fromString('QQ,JJ,ATs')
const TURN = ['Ks', '9s', '4c', '2d'].map(stringToCard)

type Hand = [Card, Card]

const conflicts = (a: Hand, b: Hand) => {
  const an = a.map(cardToNumber)
  const bn = b.map(cardToNumber)
  return an.some(x => bn.includes(x))
}

// Hero's counterfactual value per holding under a best response to villain's
// average strategy, walking the live tree.
function naiveBestResponse(
  node: GameNode,
  publicNode: number,
  hero: number,
  villainReach: Float64Array,
  solver: VectorCFR
): Float64Array {
  const tree = solver.tree
  const heroHands = solver.hands[hero].cards
  const villainHands = solver.hands[1 - hero].cards
  const out = new Float64Array(heroHands.length)

  if (node.isTerminal) {
    expect(tree.player[publicNode]).toBe(TERMINAL)
    const atRisk = Math.min(node.contributed[0], node.contributed[1])

    for (let h = 0; h < heroHands.length; h++) {
      let total = 0
      for (let g = 0; g < villainHands.length; g++) {
        const reach = villainReach[g]
        if (reach === 0) continue
        if (conflicts(heroHands[h], villainHands[g])) continue

        if (node.payoff) {
          // A fold settles from the contributions; the folder is whoever the
          // live tree paid less.
          const folder = node.payoff[0] < node.payoff[1] ? 0 : 1
          total += reach * (folder === hero ? -atRisk : atRisk)
          continue
        }
        const mine = evaluateHand([...heroHands[h], ...node.board]).value
        const theirs = evaluateHand([...villainHands[g], ...node.board]).value
        if (mine > theirs) total += reach * atRisk
        else if (mine < theirs) total -= reach * atRisk
      }
      out[h] = total
    }
    return out
  }

  if (node.isChance) {
    expect(tree.player[publicNode]).toBe(CHANCE)
    const onBoard = new Set(node.board.map(cardToNumber))
    const available = createDeck().filter(c => !onBoard.has(cardToNumber(c)))
    const n = available.length

    // One vector per card, then averaged per hero holding over the cards that
    // holding does not itself use.
    const perCard: { card: number; values: Float64Array }[] = []
    for (const card of available) {
      const cardNum = cardToNumber(card)
      const nextReach = Float64Array.from(villainReach)
      villainHands.forEach((g, i) => {
        if (g.some(c => cardToNumber(c) === cardNum)) nextReach[i] = 0
      })
      const cls = runoutClass(card, node.board, tree.classCount)
      perCard.push({
        card: cardNum,
        values: naiveBestResponse(
          advanceStreet(node, card),
          chanceChildFor(tree, publicNode, cls),
          hero,
          nextReach,
          solver
        ),
      })
    }

    for (let h = 0; h < heroHands.length; h++) {
      const mine = heroHands[h].map(cardToNumber)
      let total = 0
      for (const { card, values } of perCard) {
        if (mine.includes(card)) continue
        total += values[h]
      }
      // For any villain holding that can be dealt alongside hero's, exactly
      // n-4 cards are legal, and every illegal one contributed zero above.
      out[h] = total / (n - 4)
    }
    return out
  }

  expect(tree.player[publicNode]).toBe(node.player)
  const start = tree.actionStart[publicNode]

  if (node.player === hero) {
    // Hero picks per holding, knowing every card that is face up here and
    // nothing about the ones still to come - the chance node above has already
    // averaged those away.
    const branches = node.actions.map((action, a) =>
      naiveBestResponse(
        applyAction(node, action),
        tree.children[start + a],
        hero,
        villainReach,
        solver
      )
    )
    for (let h = 0; h < heroHands.length; h++) {
      let best = -Infinity
      for (const branch of branches) if (branch[h] > best) best = branch[h]
      out[h] = best
    }
    return out
  }

  node.actions.forEach((action, a) => {
    const nextReach = new Float64Array(villainHands.length)
    for (let g = 0; g < villainHands.length; g++) {
      nextReach[g] = villainReach[g] * solver.averageStrategy(publicNode, g)[a]
    }
    const branch = naiveBestResponse(
      applyAction(node, action),
      tree.children[start + a],
      hero,
      nextReach,
      solver
    )
    for (let h = 0; h < heroHands.length; h++) out[h] += branch[h]
  })
  return out
}

// Weight of every deal that can actually happen, computed here rather than
// read off the solver.
function dealWeight(solver: VectorCFR): number {
  let total = 0
  for (let h = 0; h < solver.hands[0].count; h++) {
    for (let g = 0; g < solver.hands[1].count; g++) {
      if (conflicts(solver.hands[0].cards[h], solver.hands[1].cards[g])) continue
      total += solver.hands[0].weight[h] * solver.hands[1].weight[g]
    }
  }
  return total
}

function naiveExploitability(solver: VectorCFR, stack: number, pot: number, board: Card[]): number {
  let perDeal = 0
  for (const hero of [0, 1]) {
    const root = createInitialNode(stack, pot, board, TINY)
    const values = naiveBestResponse(root, 0, hero, solver.hands[1 - hero].weight, solver)
    let total = 0
    for (let h = 0; h < solver.hands[hero].count; h++) {
      total += solver.hands[hero].weight[h] * values[h]
    }
    perDeal += total / dealWeight(solver)
  }
  return (perDeal / pot) * 100
}

describe('the enumerating best response against a naive reference', () => {
  for (const k of [1, 4]) {
    it(`agrees on a turn at K=${k}, where hero must choose before the river`, () => {
      const solver = new VectorCFR({
        stack: 20,
        pot: 10,
        board: TURN,
        ranges: [BTN, BB],
        config: TINY,
        seed: 7,
        runoutClasses: k,
      })
      solver.run(120)

      const mine = solver.exploitability().percentOfPot
      const reference = naiveExploitability(solver, 20, 10, TURN)
      expect(mine).toBeCloseTo(reference, 9)
    })
  }

  it('is never above the clairvoyant form, which is free to see the river first', () => {
    // max of an average can only be smaller than the average of the maxima, so
    // this is an inequality that holds by construction. It is here because it
    // is the cheapest statement of what the two numbers actually differ by.
    for (const k of [1, 4]) {
      const solver = new VectorCFR({
        stack: 20,
        pot: 10,
        board: TURN,
        ranges: [BTN, BB],
        config: TINY,
        seed: 7,
        runoutClasses: k,
      })
      solver.run(120)
      const honest = solver.exploitability().percentOfPot
      const clairvoyant = solver.clairvoyantExploitability().percentOfPot
      expect(honest, `K=${k}`).toBeGreaterThanOrEqual(-1e-9)
      expect(honest, `K=${k}`).toBeLessThanOrEqual(clairvoyant + 1e-9)
    }
  })
})
