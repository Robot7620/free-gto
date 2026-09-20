/// <reference lib="webworker" />
import { VectorCFR } from './vector-cfr'
import {
  ExploitabilityMessage,
  SolveRequest,
  SolvedMessage,
  SolverResponse,
  StrategyRow,
  deserializeBoard,
  deserializeRange,
  nextChunk,
} from './worker-protocol'

// The solve, off the main thread.
//
// Two reasons it has to be here and not in a setTimeout loop on the page. The
// obvious one is that a flop iteration is ~19 ms of dense typed-array
// arithmetic and nothing else can run while it does, so any slice big enough
// to make progress is big enough to drop frames. The less obvious one is the
// exploitability pass: it is a single synchronous walk over every ordered
// runout, about a minute on a flop, and it cannot be chopped into slices at
// all. On the main thread that is a minute of frozen page.
//
// Cancellation is `worker.terminate()` from the page rather than a message.
// The loop below never yields, so a message sent mid-solve would not be read
// until the solve it was meant to stop had already finished.

const ctx = self as unknown as DedicatedWorkerGlobalScope

const post = (message: SolverResponse) => ctx.postMessage(message)

function rows(strategy: Map<string, number>): StrategyRow[] {
  return Array.from(strategy.entries()).map(([action, frequency]) => ({ action, frequency }))
}

function solve(request: SolveRequest): void {
  const { id, seconds } = request

  post({ type: 'building', id })

  const solver = new VectorCFR({
    stack: request.stack,
    pot: request.pot,
    board: deserializeBoard(request.board),
    ranges: [deserializeRange(request.ranges[0]), deserializeRange(request.ranges[1])],
    seed: request.seed,
    runoutClasses: request.runoutClasses,
  })

  const budgetMs = seconds * 1000
  const started = Date.now()
  let iterations = 0

  // The budget is a promise to someone watching a bar, so each chunk is sized
  // from the rate measured so far and clamped to what is left of it rather
  // than allowed to run past the end. See `nextChunk`.
  while (true) {
    const elapsed = Date.now() - started
    const remaining = budgetMs - elapsed
    if (remaining <= 0) break

    const chunk = nextChunk(elapsed, iterations, remaining)
    solver.run(chunk)
    iterations += chunk

    const now = Date.now() - started
    post({
      type: 'progress',
      id,
      iterations,
      elapsedMs: now,
      fraction: Math.min(1, now / budgetMs),
    })
  }

  const elapsedMs = Date.now() - started

  // BB is out of position and acts first postflop, so the root is BB's
  // decision and BTN's first one is the node after BB checks. On a tree where
  // BB cannot check - there is none today, but the tree config is editable -
  // there is simply no BTN panel to show.
  const root = solver.nodeFor([])
  const bb = rows(solver.aggregateStrategy(root))
  const btn = solver.actionsAt(root).includes('check')
    ? rows(solver.aggregateStrategy(solver.nodeFor(['check'])))
    : null

  const solved: SolvedMessage = {
    type: 'solved',
    id,
    iterations,
    elapsedMs,
    bb,
    btn,
    shape: {
      nodes: solver.tree.nodeCount,
      slots: solver.slotCount,
      bytes: solver.bytes(),
      classCount: solver.classCount,
    },
  }
  post(solved)

  // Deliberately after the strategy has been posted. This is the honest
  // instrument - `exploitability()`, which gives the best response every card
  // that is face up when it acts and none that is still in the deck - not
  // `clairvoyantExploitability()`, which reads far worse on a flop for reasons
  // that have nothing to do with how well the spot was solved.
  const exploitabilityStarted = Date.now()
  const e = solver.exploitability()
  const measured: ExploitabilityMessage = {
    type: 'exploitability',
    id,
    percentOfPot: e.percentOfPot,
    perDeal: e.perDeal,
    elapsedMs: Date.now() - exploitabilityStarted,
  }
  post(measured)
}

ctx.onmessage = (event: MessageEvent<SolveRequest>) => {
  const request = event.data
  if (request.type !== 'solve') return
  try {
    solve(request)
  } catch (error) {
    post({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
