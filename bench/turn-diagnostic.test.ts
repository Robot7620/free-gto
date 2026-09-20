import { describe, it } from 'vitest'
import { stringToCard } from '../src/engine/cards'
import { Range } from '../src/engine/range'
import { VectorCFR } from '../src/solver/vector-cfr'

// Two questions the headline sweep leaves open, both declared before running
// and both reported whichever way they come out.
//
// 1. Ks 9h 4c 2d is RAINBOW. No suit has two board cards, so no river card can
//    ever fall in the flush class and K=4 is really K=3 there. The mechanism
//    the whole idea rests on - "plays a flush-completing card like a brick" -
//    cannot occur on that board. Ks 9s 4c 2d is the same spot with two spades,
//    where it can. If classing pays anywhere, it pays there.
//
// 2. Classes divide the samples as well as the strategy: a traversal only
//    updates the one class subtree it routed into, so K=4 gets a quarter of
//    the updates per slot at the same iteration count. The 80k checkpoint
//    separates "the classes buy nothing" from "the classes are starved" - K=1
//    has already flattened by 20k, so if K=4 is merely starved it should cross
//    below by then, and if it is not, it will not.

const BTN = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo')
const BB = Range.fromString(
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
)

const BOARDS: Record<string, string[]> = {
  'turn-rainbow': ['Ks', '9h', '4c', '2d'],
  'turn-twotone': ['Ks', '9s', '4c', '2d'],
}

const CHECKPOINTS = [8000, 20000, 80000]

// Everything printed below is exact. exploitability() enumerates the runout
// inside the walk at every depth and has no sampling path at all, so unlike
// clairvoyantExploitability() it has no exactness flag to report - it used to
// print one anyway, reading `exact=undefined`, which looked like a number that
// might have been sampled.

describe('turn diagnostic', () => {
  it('rainbow vs two-tone, K=1 vs K=4, out to 80k', () => {
    for (const [name, cards] of Object.entries(BOARDS)) {
      const board = cards.map(stringToCard)
      for (const k of [1, 4]) {
        const solver = new VectorCFR({
          stack: 100,
          pot: 10,
          board,
          ranges: [BTN, BB],
          seed: 12345,
          runoutClasses: k,
        })
        let done = 0
        for (const target of CHECKPOINTS) {
          solver.run(target - done)
          done = target
          const e = solver.exploitability()
          console.log(
            `DIAG ${name} K=${k} iters=${done} expl=${e.percentOfPot.toFixed(3)}% ` +
              `slots=${solver.slotCount}`
          )
        }
      }
    }
  })
})
