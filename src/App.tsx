import React, { useState, useEffect } from 'react'
import { Range } from './engine/range'
import { Card as CardType, stringToCard } from './engine/cards'
import { RangeGrid } from './components/RangeGrid'
import { BoardView } from './components/BoardView'
import { StrategyTable, StrategyAction } from './components/StrategyTable'
import { CFRSolver } from './solver/cfr'
import { createInitialNode } from './solver/game-tree'

function App() {
  const [btnRange, setBtnRange] = useState<Range>(Range.empty())
  const [bbRange, setBbRange] = useState<Range>(Range.empty())
  const [board, setBoard] = useState<CardType[]>([])
  const [strategy, setStrategy] = useState<StrategyAction[]>([])
  const [isSolving, setIsSolving] = useState(false)
  const [solveProgress, setSolveProgress] = useState(0)

  useEffect(() => {
    const defaultBtnRange = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,KQs,KJs,AKo,AQo')
    const defaultBbRange = Range.fromString('AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,KQs,KJs,KTs,AKo,AQo,AJo')

    setBtnRange(defaultBtnRange)
    setBbRange(defaultBbRange)

    const demoBoard = [
      stringToCard('Ks'),
      stringToCard('9h'),
      stringToCard('4c'),
    ]
    setBoard(demoBoard)

    const demoStrategy: StrategyAction[] = [
      { action: 'Check', frequency: 0.35 },
      { action: 'Bet 33% pot', frequency: 0.15 },
      { action: 'Bet 50% pot', frequency: 0.25 },
      { action: 'Bet 75% pot', frequency: 0.25 },
    ]
    setStrategy(demoStrategy)
  }, [])

  const handleSolve = async () => {
    setIsSolving(true)
    setSolveProgress(0)

    const demoHand1: CardType[] = [stringToCard('Ah'), stringToCard('Kh')]
    const demoHand2: CardType[] = [stringToCard('Qd'), stringToCard('Jd')]

    const solver = new CFRSolver()
    const rootNode = createInitialNode('BTN', 100, 10, board)

    const iterations = 1000
    const updateInterval = 100

    for (let i = 0; i < iterations; i += updateInterval) {
      await new Promise(resolve => setTimeout(resolve, 0))

      solver.solve(rootNode, [demoHand1, demoHand2], updateInterval)
      setSolveProgress(((i + updateInterval) / iterations) * 100)
    }

    const strategies = solver.getAllStrategies()
    const firstStrategy = Array.from(strategies.values())[0]

    if (firstStrategy) {
      const actions: StrategyAction[] = Array.from(firstStrategy.entries()).map(
        ([action, frequency]) => ({
          action,
          frequency,
        })
      )
      setStrategy(actions)
    }

    setIsSolving(false)
    setSolveProgress(100)
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-gray-800 text-white p-4 shadow-lg">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold">Free GTO Poker Trainer</h1>
          <p className="text-gray-300 text-sm">No Limit Hold'em - Training Tool</p>
        </div>
      </header>

      <main className="container mx-auto p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-3">Demo Scenario: BTN vs BB - K♠9♥4♣ Flop</h2>
          <p className="text-gray-600 mb-4">
            BTN opens from the button, BB calls. Single raised pot. Effective stack: 100bb. Pot: 10bb.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <RangeGrid range={btnRange} title="BTN Range (In Position)" />
          <RangeGrid range={bbRange} title="BB Range (Out of Position)" />
        </div>

        <div className="mb-6">
          <BoardView board={board} label="Flop" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <StrategyTable strategies={strategy} title="BTN Strategy (IP)" />

          <div className="bg-white p-4 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-3">Solver Controls</h3>
            <button
              onClick={handleSolve}
              disabled={isSolving}
              className={`
                w-full px-6 py-3 rounded-lg font-semibold text-white
                ${isSolving
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                }
                transition-colors
              `}
            >
              {isSolving ? `Solving... ${solveProgress.toFixed(0)}%` : 'Solve This Spot'}
            </button>

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
                This demo uses Counterfactual Regret Minimization (CFR) to compute GTO strategies.
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>1000 iterations for demo (real solves use 10k+)</li>
                <li>Simplified bet sizing (33%, 50%, 75%, pot)</li>
                <li>Single street solving</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">🎯 MVP Demo</h3>
          <p className="text-blue-800 text-sm">
            This is a working prototype demonstrating the core poker GTO solver. The ranges, board,
            and strategy shown above represent a simplified heads-up postflop scenario. Click "Solve This Spot"
            to run the CFR algorithm and see how the strategy evolves.
          </p>
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
