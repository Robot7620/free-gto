import { describe, it } from 'vitest'
import { stringToCard } from '../src/engine/cards'
import { Range } from '../src/engine/range'
import { VectorCFR } from '../src/solver/vector-cfr'

// The K=1 / K=4 / K=8 comparison, measured on both instruments at once.
//
// `clairvoyant` is what phase 5 reported and what the 20.5% / 56% figures in
// TODO.md are: the best response is handed the whole runout before it acts, so
// its turn decisions are made knowing the river. `honest` averages the runout
// inside the walk, which gives the best response every card that is face up
// when it acts and none that is not.
//
// Both are reported because the gate was written against the first and has to
// be answered in its own terms before being answered in better ones.

const BTN = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo')
const BB = Range.fromString(
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
)

const BOARDS: Record<string, string[]> = {
  // The brief's board. Rainbow, so no runout card can ever fall in the flush
  // class and K=4 is really K=3 here.
  'turn-rainbow': ['Ks', '9h', '4c', '2d'],
  // The same spot made two-tone, where the flush class is reachable and the
  // mechanism the whole idea rests on can actually occur.
  'turn-twotone': ['Ks', '9s', '4c', '2d'],
  'flop-rainbow': ['Ks', '9h', '4c'],
  'flop-twotone': ['Ks', '9s', '4c'],
}

const which = process.env.BOARDS?.split(',') ?? Object.keys(BOARDS)
const CHECKPOINTS = (process.env.CHECKPOINTS ?? '2000,8000,20000,80000')
  .split(',')
  .map(Number)

const mib = (b: number) => (b / 1024 / 1024).toFixed(1)

describe('both instruments', () => {
  it('K=1 vs K=4 vs K=8', () => {
    for (const name of which) {
      const board = BOARDS[name].map(stringToCard)
      for (const k of [1, 4, 8]) {
        const solver = new VectorCFR({
          stack: 100,
          pot: 10,
          board,
          ranges: [BTN, BB],
          seed: 12345,
          runoutClasses: k,
        })

        let peakRss = process.memoryUsage().rss
        let done = 0
        let iterSeconds = 0

        for (const target of CHECKPOINTS) {
          const t0 = Date.now()
          solver.run(target - done)
          iterSeconds += (Date.now() - t0) / 1000
          done = target
          peakRss = Math.max(peakRss, process.memoryUsage().rss)

          const h0 = Date.now()
          const honest = solver.exploitability().percentOfPot
          const honestSeconds = (Date.now() - h0) / 1000

          const c0 = Date.now()
          const clairvoyant = solver.clairvoyantExploitability()
          const clairvoyantSeconds = (Date.now() - c0) / 1000
          peakRss = Math.max(peakRss, process.memoryUsage().rss)

          console.log(
            `BOTH ${name} K=${k} iters=${done} ` +
              `honest=${honest.toFixed(3)}% clairvoyant=${clairvoyant.percentOfPot.toFixed(3)}% ` +
              `exactRunouts=${clairvoyant.exact} ` +
              `msPerIter=${((iterSeconds / done) * 1000).toFixed(1)} ` +
              `honestPass=${honestSeconds.toFixed(1)}s clairvoyantPass=${clairvoyantSeconds.toFixed(1)}s ` +
              `nodes=${solver.tree.nodeCount} slots=${solver.slotCount} ` +
              `arrays=${mib(solver.bytes())}MiB peakRss=${mib(peakRss)}MiB`
          )
        }
      }
    }
  })
})
