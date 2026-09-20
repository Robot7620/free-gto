import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from './engine/cards'
import { Range } from './engine/range'
import {
  SolveShape,
  SolverResponse,
  StrategyRow,
  serializeBoard,
  serializeRange,
} from './solver/worker-protocol'

// Owning the worker, and the state the page reads off it.
//
// One worker at a time, torn down and replaced on every new solve. That is
// cancellation: the worker loop never yields, so a "stop" message would sit
// unread until the thing it was meant to stop had finished. Terminating is
// also the only way to interrupt an exploitability pass, which is one
// uninterruptible synchronous walk.
//
// Every reply carries the id of the request that caused it, and anything from
// an older id is dropped. Terminate is immediate, but a message already posted
// and in flight is not recalled, so without the check a stale progress frame
// could land on top of a fresh solve.

export type SolvePhase = 'idle' | 'building' | 'solving' | 'measuring' | 'done' | 'error'

export interface Exploitability {
  percentOfPot: number
  perDeal: number
  elapsedMs: number
}

export interface SolveState {
  phase: SolvePhase
  // Of the time budget, in [0, 1].
  fraction: number
  iterations: number
  elapsedMs: number
  bb: StrategyRow[]
  btn: StrategyRow[]
  shape: SolveShape | null
  exploitability: Exploitability | null
  error: string | null
}

const IDLE: SolveState = {
  phase: 'idle',
  fraction: 0,
  iterations: 0,
  elapsedMs: 0,
  bb: [],
  btn: [],
  shape: null,
  exploitability: null,
  error: null,
}

export interface SolveParams {
  stack: number
  pot: number
  board: Card[]
  btnRange: Range
  bbRange: Range
  seconds: number
  seed?: number
  runoutClasses?: number
}

export function useSolver() {
  const [state, setState] = useState<SolveState>(IDLE)
  const worker = useRef<Worker | null>(null)
  const currentId = useRef(0)

  const stop = useCallback(() => {
    worker.current?.terminate()
    worker.current = null
  }, [])

  // A worker outlives the component unless it is told not to, and a flop solve
  // left running is a core of arithmetic nobody is waiting for.
  useEffect(() => stop, [stop])

  const reset = useCallback(() => {
    stop()
    currentId.current += 1
    setState(IDLE)
  }, [stop])

  const solve = useCallback(
    (params: SolveParams) => {
      stop()
      const id = (currentId.current += 1)

      const next = new Worker(new URL('./solver/solver-worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.current = next

      next.onmessage = (event: MessageEvent<SolverResponse>) => {
        const message = event.data
        if (message.id !== currentId.current) return

        switch (message.type) {
          case 'building':
            setState(s => ({ ...s, phase: 'building', error: null }))
            break
          case 'progress':
            setState(s => ({
              ...s,
              phase: 'solving',
              fraction: message.fraction,
              iterations: message.iterations,
              elapsedMs: message.elapsedMs,
            }))
            break
          case 'solved':
            // 'measuring', not 'done': the strategy is final but the
            // exploitability pass is still running, and on a flop that is
            // another minute. Saying "done" here would leave the number
            // beside the strategy looking stuck rather than pending.
            setState(s => ({
              ...s,
              phase: 'measuring',
              fraction: 1,
              iterations: message.iterations,
              elapsedMs: message.elapsedMs,
              bb: message.bb,
              btn: message.btn ?? [],
              shape: message.shape,
            }))
            break
          case 'exploitability':
            setState(s => ({
              ...s,
              phase: 'done',
              exploitability: {
                percentOfPot: message.percentOfPot,
                perDeal: message.perDeal,
                elapsedMs: message.elapsedMs,
              },
            }))
            stop()
            break
          case 'error':
            setState(s => ({ ...s, phase: 'error', error: message.message }))
            stop()
            break
        }
      }

      next.onerror = event => {
        if (id !== currentId.current) return
        setState(s => ({
          ...s,
          phase: 'error',
          error: event.message || 'the solver worker failed to start',
        }))
        stop()
      }

      setState({ ...IDLE, phase: 'building' })
      next.postMessage({
        type: 'solve',
        id,
        stack: params.stack,
        pot: params.pot,
        board: serializeBoard(params.board),
        ranges: [serializeRange(params.btnRange), serializeRange(params.bbRange)],
        seconds: params.seconds,
        seed: params.seed,
        runoutClasses: params.runoutClasses,
      })
    },
    [stop]
  )

  return { state, solve, reset }
}
