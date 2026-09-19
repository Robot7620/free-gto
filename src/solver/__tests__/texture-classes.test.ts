import { describe, it, expect } from 'vitest'
import { stringToCard } from '../../engine/cards'
import { Range } from '../../engine/range'
import { CHANCE, TERMINAL } from '../public-tree'
import { FLUSH, BRICK, PAIR, OVERCARD } from '../runout-class'
import { VectorCFR } from '../vector-cfr'

// What runout classes have to buy, and what they must not disturb.
//
// The two halves pull in opposite directions and that is the point. A river
// has no runout, so classing one is meaningless and the river solve must come
// out bit for bit identical however many classes are configured - if it moves,
// the classes have leaked into somewhere they have no business being. A turn
// does have a runout, and there the solve must come out *different*, in the
// specific direction a human would predict.

const BTN = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo')
const BB = Range.fromString(
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
)

const RIVER = ['Ks', '9h', '4c', '2d', '7s'].map(stringToCard)
// Two spades, so the flush class is reachable and every card in it is a spade.
const TWO_TONE_TURN = ['Ks', '9s', '4c', '2d'].map(stringToCard)

const solve = (board: ReturnType<typeof stringToCard>[], k: number, iterations: number) => {
  const s = new VectorCFR({
    stack: 100,
    pot: 10,
    board,
    ranges: [BTN, BB],
    seed: 12345,
    runoutClasses: k,
  })
  s.run(iterations)
  return s
}

describe('a river solve does not notice runout classes', () => {
  const ITERATIONS = 2000

  it('has the same tree, whatever K is configured', () => {
    const base = solve(RIVER, 1, 0)
    for (const k of [4, 8]) {
      const other = solve(RIVER, k, 0)
      expect(other.tree.nodeCount, `K=${k}`).toBe(base.tree.nodeCount)
      expect(other.slotCount, `K=${k}`).toBe(base.slotCount)
      // Nothing to deal, so no chance node exists to branch on.
      expect([...other.tree.player].some(p => p === CHANCE)).toBe(false)
    }
  })

  it('produces a bit-identical strategy at K=1, K=4 and K=8', () => {
    // Exact equality, not a tolerance. There is no runout to sample, so the
    // arithmetic and the random stream are the same sequence three times over,
    // and anything less than equality means K reached something it should not
    // have. A tolerance here would hide exactly the bug this is looking for.
    const base = solve(RIVER, 1, ITERATIONS)

    for (const k of [4, 8]) {
      const other = solve(RIVER, k, ITERATIONS)
      let compared = 0
      for (let node = 0; node < base.tree.nodeCount; node++) {
        const player = base.tree.player[node]
        if (player === CHANCE || player === TERMINAL) continue
        for (let hand = 0; hand < base.hands[player].count; hand++) {
          const a = base.averageStrategy(node, hand)
          const b = other.averageStrategy(node, hand)
          for (let i = 0; i < a.length; i++) {
            expect(b[i], `K=${k} node ${node} hand ${hand} action ${i}`).toBe(a[i])
          }
          compared++
        }
      }
      expect(compared).toBe(base.infoSetCount)
    }
  })

  it('reports the same exploitability at K=1, K=4 and K=8', () => {
    const base = solve(RIVER, 1, ITERATIONS).exploitability()
    for (const k of [4, 8]) {
      const other = solve(RIVER, k, ITERATIONS).exploitability()
      expect(other.exact).toBe(true)
      expect(other.percentOfPot, `K=${k}`).toBe(base.percentOfPot)
    }
  })
})

describe('a turn solve plays the river class it is given', () => {
  // Ks 9s 4c 2d. The only suit with two board cards is spades, so every card
  // in the flush class is a spade and no card in any other class is. That
  // makes the classing do something a human can check: AsQs holds the nut
  // flush in the flush class and ace-high in the brick class, with nothing in
  // between and no card in either class where that isn't true.
  const ITERATIONS = 6000
  const solver = solve(TWO_TONE_TURN, 4, ITERATIONS)

  const facingBet = (cls: number) => solver.nodeFor(['check', 'check', 'bet50'], [cls])

  // The index of one specific holding, not the combo class - AsQs is the only
  // AQs that can make a flush here, so aggregating over the class would drown
  // the effect in three hands that cannot.
  const holding = (player: number, a: string, b: string) => {
    const wanted = [a, b].sort().join('')
    const index = solver.hands[player].cards.findIndex(
      cards =>
        cards
          .map(c => '23456789TJQKA'[c.rank] + 'cdhs'[c.suit])
          .sort()
          .join('') === wanted
    )
    if (index < 0) throw new Error(`${a}${b} is not in player ${player}'s range here`)
    return index
  }

  const foldRate = (cls: number, hand: number) => {
    const node = facingBet(cls)
    const actions = solver.actionsAt(node)
    return solver.averageStrategy(node, hand)[actions.indexOf('fold')]
  }

  it('sends each class to its own node, with BTN to act', () => {
    const nodes = [PAIR, FLUSH, OVERCARD, BRICK].map(facingBet)
    expect(new Set(nodes).size).toBe(4)
    for (const node of nodes) expect(solver.tree.player[node]).toBe(0)
  })

  it('never folds the nut flush, and folds the same holding as ace-high', () => {
    const nutFlushDraw = holding(0, 'As', 'Qs')
    const onFlush = foldRate(FLUSH, nutFlushDraw)
    const onBrick = foldRate(BRICK, nutFlushDraw)
    console.log(
      `      AsQs facing a half-pot river bet: folds ${(onFlush * 100).toFixed(1)}% ` +
        `on a spade (nut flush), ${(onBrick * 100).toFixed(1)}% on a brick (ace-high)`
    )

    // At K=1 these are the same number by construction, because they are the
    // same node. This is the assertion the whole task exists to make true.
    expect(onFlush, 'a nut flush must not fold').toBeLessThan(0.02)
    expect(onBrick, 'ace-high with no pair must fold most of the time').toBeGreaterThan(0.5)
  })

  it('folds a set less often than ace-high on every class, as a sanity check', () => {
    // Not about classes at all - it is the check that the class-routed nodes
    // are still solving poker rather than returning noise.
    const set = holding(0, '9h', '9d')
    const aceHigh = holding(0, 'Ah', 'Qd')
    for (const cls of [PAIR, FLUSH, OVERCARD, BRICK]) {
      expect(foldRate(cls, set), `99 at class ${cls}`).toBeLessThan(foldRate(cls, aceHigh))
    }
  })
})
