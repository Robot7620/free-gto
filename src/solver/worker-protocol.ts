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
