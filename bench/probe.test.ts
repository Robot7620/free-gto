import { describe, it } from 'vitest'
import { stringToCard } from '../src/engine/cards'
import { Range } from '../src/engine/range'
import { VectorCFR } from '../src/solver/vector-cfr'

const BTN = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo')
const BB = Range.fromString(
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
)
const FLOP = ['Ks', '9h', '4c'].map(stringToCard)
const TURN = ['Ks', '9h', '4c', '2d'].map(stringToCard)

const mib = (b: number) => (b / 1024 / 1024).toFixed(1)

describe('probe', () => {
  it('times an iteration and an exploitability pass', () => {
    for (const [name, board] of [
      ['turn', TURN],
      ['flop', FLOP],
    ] as const) {
      for (const k of [1, 4, 8]) {
        const t0 = Date.now()
        const s = new VectorCFR({
          stack: 100,
          pot: 10,
          board,
          ranges: [BTN, BB],
          seed: 12345,
          runoutClasses: k,
        })
        const build = Date.now() - t0

        const t1 = Date.now()
        s.run(50)
        const perIter = (Date.now() - t1) / 50

        const t2 = Date.now()
        const e = s.exploitability()
        const expl = Date.now() - t2

        console.log(
          `${name} K=${k}: build ${build}ms, ${perIter.toFixed(1)}ms/iter, ` +
            `arrays ${mib(s.bytes())} MiB, slots ${s.slotCount}, ` +
            `exploitability pass ${(expl / 1000).toFixed(1)}s over ${e.runouts} runouts ` +
            `(exact=${e.exact}), heap ${mib(process.memoryUsage().heapUsed)} MiB`
        )
      }
    }
  })
})
