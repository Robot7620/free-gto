import { useState, useEffect } from 'react'
import { Range } from './engine/range'
import { Card as CardType, stringToCard, cardToNumber } from './engine/cards'
import { RangeGrid } from './components/RangeGrid'
import { BoardView } from './components/BoardView'
import { CardPicker } from './components/CardPicker'
import { StrategyTable, StrategyAction } from './components/StrategyTable'
import { CFRSolver } from './solver/cfr'
import { createInitialNode } from './solver/game-tree'

const DEFAULT_BTN_RANGE = 'AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo'
const DEFAULT_BB_RANGE =
  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo'
const DEFAULT_BOARD = ['Ks', '9h', '4c']
const DEFAULT_STACK = 100
const DEFAULT_POT = 10

const ITERATIONS = 20000
const UPDATE_INTERVAL = 1000

function App() {
  const [btnRange, setBtnRange] = useState<Range>(Range.empty())
  const [bbRange, setBbRange] = useState<Range>(Range.empty())
  const [board, setBoard] = useState<CardType[]>([])
  const [stack, setStack] = useState(DEFAULT_STACK)
  const [pot, setPot] = useState(DEFAULT_POT)
  const [strategy, setStrategy] = useState<StrategyAction[]>([])
  const [isSolving, setIsSolving] = useState(false)
  const [solveProgress, setSolveProgress] = useState(0)

  useEffect(() => {
    resetScenario()
  }, [])

  function resetScenario() {
    setBtnRange(Range.fromString(DEFAULT_BTN_RANGE))
    setBbRange(Range.fromString(DEFAULT_BB_RANGE))
    setBoard(DEFAULT_BOARD.map(stringToCard))
    setStack(DEFAULT_STACK)
    setPot(DEFAULT_POT)
    setStrategy([])
  }

  // Any change to the spot invalidates the strategy that was solved for it.
  function toggleCombo(range: Range, setRange: (r: Range) => void, combo: string) {
    const next = range.clone()
    next.setWeight(combo, range.getWeight(combo) > 0 ? 0 : 1)
    setRange(next)
    setStrategy([])
  }

  function toggleBoardCard(card: CardType) {
    const n = cardToNumber(card)
    const exists = board.some(c => cardToNumber(c) === n)
    setBoard(exists ? board.filter(c => cardToNumber(c) !== n) : [...board, card])
    setStrategy([])
  }

  const canSolve =
    board.length >= 3 && !btnRange.isEmpty() && !bbRange.isEmpty() && pot > 0 && stack > 0

  const handleSolve = async () => {
    setIsSolving(true)
    setSolveProgress(0)

    const solver = new CFRSolver()
    const rootNode = createInitialNode(stack, pot, board)

    for (let i = 0; i < ITERATIONS; i += UPDATE_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, 0))

      solver.solve(rootNode, [btnRange, bbRange], board, UPDATE_INTERVAL)
      setSolveProgress(((i + UPDATE_INTERVAL) / ITERATIONS) * 100)
    }

    const rangeStrategy = solver.getRangeStrategy(btnRange, board)

    setStrategy(
      Array.from(rangeStrategy.entries()).map(([action, frequency]) => ({
        action,
        frequency,
      }))
    )

    setIsSolving(false)
    setSolveProgress(100)
  }

  const streetLabel =
    board.length >= 5 ? 'River' : board.length === 4 ? 'Turn' : board.length === 3 ? 'Flop' : 'Board'

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
                    setStrategy([])
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
                    setStrategy([])
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        <p className="text-gray-600 mb-4 text-sm">
          Click any hand in a range to add or remove it. BTN acts first in this
          single-street model.
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
          {strategy.length > 0 ? (
            <StrategyTable strategies={strategy} title="BTN Strategy (IP)" />
          ) : (
            <div className="bg-white p-4 rounded-lg shadow-md">
              <h3 className="text-lg font-semibold mb-3">BTN Strategy (IP)</h3>
              <p className="text-gray-500 text-sm">
                Solve the spot to see the strategy for this range.
              </p>
            </div>
          )}

          <div className="bg-white p-4 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-3">Solver Controls</h3>
            <button
              onClick={handleSolve}
              disabled={isSolving || !canSolve}
              className={`
                w-full px-6 py-3 rounded-lg font-semibold text-white
                ${isSolving || !canSolve
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                }
                transition-colors
              `}
            >
              {isSolving ? `Solving... ${solveProgress.toFixed(0)}%` : 'Solve This Spot'}
            </button>

            {!canSolve && !isSolving && (
              <p className="text-sm text-amber-700 mt-2">
                Needs at least 3 board cards and a hand in each range.
              </p>
            )}

            {isSolving && (
              <div className="mt-4">
                <div className="bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${solveProgress}%` }}
                  ></div>
                </div>
              </div>
            )}

            <div className="mt-6 text-sm text-gray-600">
              <h4 className="font-semibold mb-2">About the Solver</h4>
              <p className="mb-2">
                This uses Counterfactual Regret Minimization (CFR) to compute GTO strategies.
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>{ITERATIONS.toLocaleString()} iterations, chance-sampled over both ranges</li>
                <li>Simplified bet sizing (33%, 50%, 75%, pot, all-in)</li>
                <li>Single street solving, max 3 bets/raises</li>
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
