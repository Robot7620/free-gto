import { describe, it } from 'vitest'
import { stringToCard } from '../src/engine/cards'
import { Range } from '../src/engine/range'
import { VectorCFR } from '../src/solver/vector-cfr'

// K=1 against K=4 at the iteration counts the app actually reaches.
//
// The sweeps that decided the question run to 20,000 and 80,000 iterations.
// Nobody sitting in front of the page gets near that. The time budget defaults
// to ten seconds, and per-iteration cost is flat in K but very much not flat
// per street, so ten seconds buys roughly:
//
//   river  ~16,000 iterations at 0.6 ms   (K is provably irrelevant here)
//   turn    ~2,100 iterations at 4.7 ms
//   flop      ~420 iterations at 19 ms
//
// The flop figure is measured rather than derived: a browser run of an
// eight-second budget did 416 iterations. So the default K has to be right at
// a few hundred flop iterations and a couple of thousand turn ones, and the
// converged answer is not evidence about either. Classes divide the updates as
// well as the strategy - a traversal only touches the class subtree it routes
// into - and starvation is worst exactly where the samples are fewest.
//
// Declared before running: if K=4 is behind K=1 here while being ahead at 20k,
// the default is a choice between the solver the app runs and the solver it
// could run, and this bench is the evidence for calling it either way.

const BTN = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo')
const BB = Range.fromString(
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
)

const TURNS: Record<string, string[]> = {
  'turn-rainbow': ['Ks', '9h', '4c', '2d'],
  'turn-twotone': ['Ks', '9s', '4c', '2d'],
}

const FLOPS: Record<string, string[]> = {
  'flop-rainbow': ['Ks', '9h', '4c'],
  'flop-twotone': ['Ks', '9s', '4c'],
}

// A turn exploitability pass is 48 runouts and cheap, so the curve can be
// sampled finely. A flop pass is 2,352 ordered runouts and about a minute, so
// two points: the ten-second budget, and four times it.
const TURN_CHECKPOINTS = [500, 1000, 2000, 4000]
const FLOP_CHECKPOINTS = [400, 1600]

function sweep(
  boards: Record<string, string[]>,
  checkpoints: number[],
  tag: string
): void {
  for (const [name, cards] of Object.entries(boards)) {
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
      for (const target of checkpoints) {
        solver.run(target - done)
        done = target
        // Exact at every depth; exploitability() enumerates rather than
        // samples, so there is no sample count to report.
        const e = solver.exploitability()
        console.log(`${tag} ${name} K=${k} iters=${done} expl=${e.percentOfPot.toFixed(3)}%`)
      }
    }
  }
}

describe('the regime the app runs in', () => {
  it('turn, 500 to 4000 iterations', () => {
    sweep(TURNS, TURN_CHECKPOINTS, 'APPTURN')
  })

  it('flop, 400 and 1600 iterations', () => {
    sweep(FLOPS, FLOP_CHECKPOINTS, 'APPFLOP')
  })
})
