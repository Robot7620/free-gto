import { useState, useEffect } from 'react'
import { Range } from './engine/range'
import { Card as CardType, stringToCard, cardToNumber } from './engine/cards'
import { RangeGrid } from './components/RangeGrid'
import { BoardView } from './components/BoardView'
import { CardPicker } from './components/CardPicker'
import { StrategyTable } from './components/StrategyTable'
import { ExploitabilityBadge } from './components/ExploitabilityBadge'
import { DEFAULT_TREE_CONFIG } from './solver/game-tree'
import { DEFAULT_RUNOUT_CLASSES } from './solver/vector-cfr'
import { classNames } from './solver/runout-class'
import { useSolver } from './useSolver'

const DEFAULT_BTN_RANGE = 'AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo'
const DEFAULT_BB_RANGE =
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
const DEFAULT_BOARD = ['Ks', '9h', '4c']
const DEFAULT_STACK = 100
const DEFAULT_POT = 10

// Read off the tree config rather than restated by hand: this line already
// went stale once, advertising sizings the solver had stopped offering.
const SIZING_LABEL = [
  ...DEFAULT_TREE_CONFIG.betFractions.map(([, f]) => `${Math.round(f * 100)}% pot`),
  'all-in',
].join(', ')

// Same reason as the sizing label: named from the class scheme itself, so
// changing K cannot leave the page describing the old one. Taken from the tree
// that was actually solved where there is one, and from the default before the
// first solve - the two can only differ once something lets K be chosen, but
// describing the solve in front of you is the version that stays true.
function runoutLabel(classCount: number): string {
  if (classCount === 1) {
    return 'Every runout card treated alike - the tree records the street, not which card fell'
  }
  return `Runouts sorted into ${classCount} texture classes (${classNames(classCount).join(', ')})`
}

// Seconds, not iterations. An iteration costs the same at every K but very
// different amounts per street - about 0.6 ms on a river against 19 ms on a
// flop - so a count that is sensible on one board is either instant or
// interminable on another. Ten seconds is about 420 flop
// iterations, 2,100 turn ones or 16,000 on a river - measured from a browser
// run, not derived. That is the right shape for a default: enough to be worth
// looking at, short enough that nobody walks away. It is also far short of
// converged on a flop, which is why the runout class count defaults to 1 -
// see DEFAULT_RUNOUT_CLASSES.
const DEFAULT_SECONDS = 10

function App() {
  const [btnRange, setBtnRange] = useState<Range>(Range.empty())
  const [bbRange, setBbRange] = useState<Range>(Range.empty())
  const [board, setBoard] = useState<CardType[]>([])
  const [stack, setStack] = useState(DEFAULT_STACK)
  const [pot, setPot] = useState(DEFAULT_POT)
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS)
  const { state, solve, reset: resetSolver } = useSolver()

  useEffect(() => {
    resetScenario()
    // Setting the scenario up once on mount. resetScenario closes over
    // resetSolver, which is stable, but listing it would still re-run this on
    // any future change to the hook and wipe whatever the user had entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetScenario() {
    setBtnRange(Range.fromString(DEFAULT_BTN_RANGE))
    setBbRange(Range.fromString(DEFAULT_BB_RANGE))
    setBoard(DEFAULT_BOARD.map(stringToCard))
    setStack(DEFAULT_STACK)
    setPot(DEFAULT_POT)
    setSeconds(DEFAULT_SECONDS)
    resetSolver()
  }

  // Any change to the spot invalidates the strategy that was solved for it,
  // and stops a solve that is still running for the old one.
  function invalidate() {
    resetSolver()
  }

  function toggleCombo(range: Range, setRange: (r: Range) => void, combo: string) {
    const next = range.clone()
    next.setWeight(combo, range.getWeight(combo) > 0 ? 0 : 1)
    setRange(next)
    invalidate()
  }

  function toggleBoardCard(card: CardType) {
    const n = cardToNumber(card)
    const exists = board.some(c => cardToNumber(c) === n)
    setBoard(exists ? board.filter(c => cardToNumber(c) !== n) : [...board, card])
    invalidate()
  }

  const canSolve =
    board.length >= 3 && !btnRange.isEmpty() && !bbRange.isEmpty() && pot > 0 && stack > 0

  const busy = state.phase === 'building' || state.phase === 'solving'
  const hasStrategy = state.bb.length > 0

  const handleSolve = () => {
    solve({ stack, pot, board, btnRange, bbRange, seconds })
  }

  const streetLabel =
    board.length >= 5 ? 'River' : board.length === 4 ? 'Turn' : board.length === 3 ? 'Flop' : 'Board'

  const buttonLabel =
    state.phase === 'building'
      ? 'Building the board table...'
      : state.phase === 'solving'
        ? `Solving... ${(state.fraction * 100).toFixed(0)}%`
        : 'Solve This Spot'

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-gray-800 text-white p-4 shadow-lg">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold">Free GTO Poker Trainer</h1>
          <p className="text-gray-300 text-sm">No Limit Hold'em - Training Tool</p>
        </div>
      </header>

      <main className="container mx-auto p-6">
        <div className="bg-white p-4 rounded-lg shadow-md mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Scenario</h2>
            <button
              onClick={resetScenario}
              className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              Reset to default
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Board ({board.length}/5) - click to add or remove
              </label>
              <CardPicker selected={board} onToggle={toggleBoardCard} />
              {board.length < 3 && (
                <p className="text-sm text-amber-700 mt-2">
                  Pick at least 3 cards to solve a flop.
                </p>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="stack"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Effective stack (bb)
                </label>
                <input
                  id="stack"
                  type="number"
                  min={1}
                  value={stack}
                  onChange={e => {
                    setStack(Math.max(1, Number(e.target.value) || 0))
                    invalidate()
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="pot" className="block text-sm font-medium text-gray-700 mb-1">
                  Starting pot (bb)
                </label>
                <input
                  id="pot"
                  type="number"
                  min={1}
                  value={pot}
                  onChange={e => {
                    setPot(Math.max(1, Number(e.target.value) || 0))
                    invalidate()
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="seconds"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Solve for (seconds)
                </label>
                <input
                  id="seconds"
                  type="number"
                  min={1}
                  max={600}
                  value={seconds}
                  onChange={e =>
                    setSeconds(Math.min(600, Math.max(1, Number(e.target.value) || 0)))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  A time budget rather than an iteration count: an iteration is
                  ~0.6 ms on a river and ~19 ms on a flop, so seconds mean the
                  same thing on every board and iterations do not.
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-gray-600 mb-4 text-sm">
          Click any hand in a range to add or remove it. BB is out of position and
          acts first on every street.
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <RangeGrid
            range={btnRange}
            title="BTN Range (In Position)"
            onCellClick={combo => toggleCombo(btnRange, setBtnRange, combo)}
          />
          <RangeGrid
            range={bbRange}
            title="BB Range (Out of Position)"
            onCellClick={combo => toggleCombo(bbRange, setBbRange, combo)}
          />
        </div>

        <div className="mb-6">
          <BoardView board={board} label={streetLabel} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <div className="space-y-6">
            {hasStrategy ? (
              <StrategyTable
                strategies={state.bb}
                title={`BB (OOP) - first to act on the ${streetLabel.toLowerCase()}`}
              />
            ) : (
              <div className="bg-white p-4 rounded-lg shadow-md">
                <h3 className="text-lg font-semibold mb-3">BB Strategy (OOP)</h3>
                <p className="text-gray-500 text-sm">
                  Solve the spot to see the strategy for this range.
                </p>
              </div>
            )}

            {state.btn.length > 0 && (
              <StrategyTable strategies={state.btn} title="BTN (IP) - after BB checks" />
            )}

            {hasStrategy && (
              <ExploitabilityBadge
                percentOfPot={state.exploitability?.percentOfPot ?? null}
                measuring={state.phase === 'measuring'}
              />
            )}
          </div>

          <div className="bg-white p-4 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-3">Solver Controls</h3>
            <button
              onClick={handleSolve}
              disabled={busy || !canSolve}
              data-testid="solve"
              className={`
                w-full px-6 py-3 rounded-lg font-semibold text-white
                ${busy || !canSolve
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                }
                transition-colors
              `}
            >
              {buttonLabel}
            </button>

            {!canSolve && !busy && (
              <p className="text-sm text-amber-700 mt-2">
                Needs at least 3 board cards and a hand in each range.
              </p>
            )}

            {(busy || state.phase === 'measuring') && (
              <div className="mt-4">
                <div className="bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${state.fraction * 100}%` }}
                  ></div>
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-500">
                  <span data-testid="iterations">
                    {state.iterations.toLocaleString()} iterations
                  </span>
                  <span>{(state.elapsedMs / 1000).toFixed(1)}s</span>
                </div>
                <button
                  onClick={resetSolver}
                  data-testid="stop"
                  className="mt-3 w-full px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Stop
                </button>
              </div>
            )}

            {state.phase === 'done' && (
              <p className="mt-3 text-sm text-gray-600" data-testid="solve-summary">
                {state.iterations.toLocaleString()} iterations in{' '}
                {(state.elapsedMs / 1000).toFixed(1)}s.
              </p>
            )}

            {state.phase === 'error' && (
              <p className="mt-3 text-sm text-red-700" data-testid="solve-error">
                The solve failed: {state.error}
              </p>
            )}

            <div className="mt-6 text-sm text-gray-600">
              <h4 className="font-semibold mb-2">About the Solver</h4>
              <p className="mb-2">
                Vectorized counterfactual regret minimization, run in a Web
                Worker so the page stays usable while it works. Every holding in
                both ranges is updated on every iteration - hole cards are exact,
                not bucketed by strength.
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>Runs for the time budget above, not a fixed iteration count</li>
                <li>Bet sizing: {SIZING_LABEL}</li>
                <li>
                  Plays to showdown through the turn and river, at most{' '}
                  {DEFAULT_TREE_CONFIG.maxAggressiveActions} bets or raises per street
                </li>
                <li>{runoutLabel(state.shape?.classCount ?? DEFAULT_RUNOUT_CLASSES)}</li>
                {state.shape && (
                  <li data-testid="shape">
                    This tree: {state.shape.nodes.toLocaleString()} nodes,{' '}
                    {state.shape.slots.toLocaleString()} regret slots,{' '}
                    {(state.shape.bytes / 1024 / 1024).toFixed(1)} MiB
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-gray-800 text-gray-400 p-4 mt-8">
        <div className="container mx-auto text-center text-sm">
          <p>Free GTO Poker Trainer v0.1.0 - Open Source Alternative to Commercial Solvers</p>
        </div>
      </footer>
    </div>
  )
}

export default App
