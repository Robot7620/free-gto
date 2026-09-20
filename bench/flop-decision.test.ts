import { describe, it } from 'vitest'
import { stringToCard } from '../src/engine/cards'
import { Range } from '../src/engine/range'
import { VectorCFR } from '../src/solver/vector-cfr'

// What K should default to, decided on a flop rather than on a turn.
//
// The turn sweeps answered the question on one chance node. A flop has two, so
// it is where both effects are largest: the strategic resolution classes buy,
// and the sample dilution they cost. K=4 copies the turn four times and the
// river sixteen, which is 51,111 nodes against 3,957 and a quarter of the
// updates per slot per chance level - so if K=4 is merely starved rather than
// wrong, a flop is where it shows worst and where running long enough to
// outrun it is worth the wall clock.
//
// Both boards, because a rainbow flop has no suit with two cards on it, so no
// turn card can land in the flush class. K=4 is really K=3 there and the
// mechanism the idea rests on cannot occur until the turn puts a second suit
// down. The two-tone board is the one to read the verdict off.
//
// K=8 is not measured here. It was measured on a turn, where it bought nothing
// over K=4, and a flop at K=8 is 234.6 MiB and 197,171 nodes - four times the
// dilution of an arrangement that already failed to pay. The open question is
// 1 against 4.
//
// exploitability() enumerates rather than samples at every depth, so every
// honest number below is exact. clairvoyantExploitability() enumerates all
// 2,352 ordered flop runouts, under its 4,096 limit, so it is exact too and
// says which in the clairvoyantExact field.

const BTN = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo')
const BB = Range.fromString(
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
)

const BOARDS: Record<string, string[]> = {
  'flop-rainbow': ['Ks', '9h', '4c'],
  'flop-twotone': ['Ks', '9s', '4c'],
}

const CHECKPOINTS = (process.env.CHECKPOINTS ?? '2000,8000,20000,80000')
  .split(',')
  .map(Number)
const KS = (process.env.KS ?? '1,4').split(',').map(Number)

const mib = (b: number) => (b / 1024 / 1024).toFixed(1)

describe('flop decision', () => {
  it('K=1 vs K=4 on a rainbow and a two-tone flop', () => {
    for (const [name, cards] of Object.entries(BOARDS)) {
      const board = cards.map(stringToCard)
      for (const k of KS) {
        const solver = new VectorCFR({
          stack: 100,
          pot: 10,
          board,
          ranges: [BTN, BB],
          seed: 12345,
          runoutClasses: k,
        })

        let done = 0
        let iterSeconds = 0
        for (const target of CHECKPOINTS) {
          const t0 = Date.now()
          solver.run(target - done)
          iterSeconds += (Date.now() - t0) / 1000
          done = target

          const honest = solver.exploitability().percentOfPot
          const clair = solver.clairvoyantExploitability()

          console.log(
            `FLOP ${name} K=${k} iters=${done} ` +
              `honest=${honest.toFixed(3)}% clairvoyant=${clair.percentOfPot.toFixed(3)}% ` +
              `clairvoyantExact=${clair.exact} clairvoyantRunouts=${clair.runouts} ` +
              `msPerIter=${((iterSeconds / done) * 1000).toFixed(1)} ` +
              `nodes=${solver.tree.nodeCount} slots=${solver.slotCount} ` +
              `arrays=${mib(solver.bytes())}MiB`
          )
        }
      }
    }
  })
})
