import { describe, it } from 'vitest'
import { stringToCard } from '../src/engine/cards'
import { Range } from '../src/engine/range'
import { VectorCFR } from '../src/solver/vector-cfr'

// How long one honest exploitability pass costs on a flop, so the real sweep
// can be sized rather than guessed at.

const BTN = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo')
const BB = Range.fromString(
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
)
const FLOP = ['Ks', '9h', '4c'].map(stringToCard)

describe('flop probe', () => {
  it('times one honest pass against one clairvoyant pass', () => {
    for (const k of [1, 4]) {
      const s = new VectorCFR({
        stack: 100,
        pot: 10,
        board: FLOP,
        ranges: [BTN, BB],
        seed: 12345,
        runoutClasses: k,
      })
      const t0 = Date.now()
      s.run(200)
      const perIter = (Date.now() - t0) / 200

      const h0 = Date.now()
      const honest = s.exploitability().percentOfPot
      const hs = (Date.now() - h0) / 1000

      const c0 = Date.now()
      const clair = s.clairvoyantExploitability().percentOfPot
      const cs = (Date.now() - c0) / 1000

      console.log(
        `PROBE flop K=${k} iters=200 honest=${honest.toFixed(3)}% clairvoyant=${clair.toFixed(3)}% ` +
          `msPerIter=${perIter.toFixed(1)} honestPass=${hs.toFixed(1)}s clairvoyantPass=${cs.toFixed(1)}s ` +
          `rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)}MiB`
      )
    }
  })
})
