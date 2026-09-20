import { Card, cardToString, stringToCard } from '../engine/cards'
import { Range } from '../engine/range'

// What crosses the worker boundary.
//
// Everything here has to survive structured clone, so a Range goes over as its
// weighted combos and a Card as its two characters rather than as the objects
// themselves - a Range is a class with methods, and a Card is a pair of enum
// members that would arrive as bare numbers with no way back.
//
// The request carries a time budget rather than an iteration count. Per
// iteration the solver costs the same at every K (a traversal visits one
// successor per chance node whatever K is), but it costs very differently per
// street - ~0.6 ms on a river against ~19 ms on a flop - so an iteration count
// that is sensible on one board is either instant or interminable on another.
// Seconds are the thing a person actually has an opinion about.

export interface SerializedRange {
  combo: string
  weight: number
}

export function serializeRange(range: Range): SerializedRange[] {
  return range.getWeightedCombos()
}

export function deserializeRange(combos: SerializedRange[]): Range {
  return new Range(new Map(combos.map(({ combo, weight }) => [combo, weight])))
}

export function serializeBoard(board: Card[]): string[] {
  return board.map(cardToString)
}

export function deserializeBoard(board: string[]): Card[] {
  return board.map(stringToCard)
}

// How long one chunk of iterations should aim to take. Short enough that the
// progress bar moves and the elapsed time reported with it is honest; long
// enough that one postMessage per chunk is noise against the arithmetic.
export const CHUNK_MS = 150

// Sizing the first chunk is a chicken-and-egg problem - ms/iteration spans a
// factor of thirty between a river and a flop, so any fixed guess is wrong on
// one of them. Start with a handful, measure, converge.
export const PROBE_ITERATIONS = 4

// How many iterations to run next, given what the solve has cost so far.
//
// Pure, and exported, because the arithmetic has a hole in it that is invisible
// by inspection and unreachable in a test that goes through a Worker: when
// `elapsedMs` is 0 the measured rate is zero, and dividing by it gives a chunk
// of Infinity, which is `solver.run(Infinity)` and a wedged thread. `Date.now`
// has millisecond resolution and four iterations on a short-stack river tree
// are well under a millisecond, so a zero elapsed time is a thing that happens
// on a fast machine rather than a thing that cannot.
export function nextChunk(elapsedMs: number, iterations: number, remainingMs: number): number {
  if (iterations <= 0 || elapsedMs <= 0) return PROBE_ITERATIONS

  const perIteration = elapsedMs / iterations
  const aimed = Math.round(CHUNK_MS / perIteration)
  const fits = Math.floor(remainingMs / perIteration)

  // Never below one. A two-second budget on a flop is only about a hundred
  // iterations, and returning an untouched tree because the next one would
  // have overrun the budget by 19 ms helps nobody.
  return Math.max(1, Math.min(aimed, fits))
}

export interface SolveRequest {
  type: 'solve'
  // Echoed on every reply. The client drops anything from an older solve, so a
  // late progress message from a run the user has already replaced cannot
  // overwrite the new one's state.
  id: number
  stack: number
  pot: number
  board: string[]
  // [BTN / in position, BB / out of position], matching VectorCFROptions.
  ranges: [SerializedRange[], SerializedRange[]]
  seconds: number
  seed?: number
  runoutClasses?: number
}

export interface StrategyRow {
  action: string
  frequency: number
}

export interface SolveShape {
  nodes: number
  slots: number
  bytes: number
  classCount: number
}

// Building the showdown table is ~0.9 s on a flop and happens before the first
// iteration, so without a status of its own the button sits at 0% looking
// wedged.
export interface BuildingMessage {
  type: 'building'
  id: number
}

export interface ProgressMessage {
  type: 'progress'
  id: number
  iterations: number
  elapsedMs: number
  // Of the budget, in [0, 1].
  fraction: number
}

// The strategy lands as soon as the iterations stop. Exploitability follows
// separately because it is not cheap: an exact pass on a flop enumerates every
// ordered runout and takes about a minute, which is longer than most solves.
// Waiting for it before showing anything would hide a finished result behind a
// measurement of it.
export interface SolvedMessage {
  type: 'solved'
  id: number
  iterations: number
  elapsedMs: number
  bb: StrategyRow[]
  btn: StrategyRow[] | null
  shape: SolveShape
}

export interface ExploitabilityMessage {
  type: 'exploitability'
  id: number
  percentOfPot: number
  perDeal: number
  elapsedMs: number
}

export interface ErrorMessage {
  type: 'error'
  id: number
  message: string
}

export type SolverResponse =
  | BuildingMessage
  | ProgressMessage
  | SolvedMessage
  | ExploitabilityMessage
  | ErrorMessage
