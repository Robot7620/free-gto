import { describe, it, expect, beforeAll } from 'vitest'
import {
  createInitialNode,
  applyAction,
  advanceStreet,
  GameNode,
  TreeConfig,
  DEFAULT_TREE_CONFIG,
  RICH_TREE_CONFIG,
} from '../game-tree'
import { stringToCard, createDeck, cardToNumber, Card } from '../../engine/cards'

// Structural invariants for the multi-street game tree, checked by walking it
// exhaustively.
//
// This deliberately re-derives everything it checks from the public GameNode
// fields and the documented history format, rather than importing game-tree's
// own helpers (currentStreetHistory, countAggressiveActions, ...). Auditing an
// implementation with its own internals would just assert that it agrees with
// itself. Two real bugs were found this way - see the EPSILON note in
// game-tree.ts.

const STARTING_STACK = 100
const STARTING_POT = 10
const BOARD: Card[] = ['Ks', '9h', '4c'].map(stringToCard)

// The exhaustive tree at these parameters (2 runouts per chance node) is
// ~290k nodes, depth 15. The cap is a guard against a regression making the
// tree explode, not a budget we expect to approach.
const NODE_CAP = 400_000
const EPS = 1e-6
const AGGRESSIVE = new Set(['bet33', 'bet50', 'bet75', 'betpot', 'allin'])

interface Failure {
  history: string
  detail: string
}

type Invariant =
  | 'chip_conservation'
  | 'non_negative_stacks'
  | 'zero_sum_payoffs'
  | 'street_progression'
  | 'street_contributed'
  | 'action_legality'
  | 'raise_cap'
  | 'all_in_behavior'

interface WalkResult {
  failures: Record<Invariant, Failure[]>
  nodeCount: number
  maxDepth: number
  aborted: string | null
}

// history looks like "bet50/call|Kd:check/bet33" - streets separated by '|',
// a dealt street starting with "<card>:", actions within a street by '/'.
function currentStreetSegment(history: string): string {
  const segment = history.split('|').pop() ?? ''
  const colon = segment.indexOf(':')
  return colon === -1 ? segment : segment.slice(colon + 1)
}

function aggressiveCountInStreet(history: string): number {
  const segment = currentStreetSegment(history)
  if (!segment) return 0
  return segment.split('/').filter(token => AGGRESSIVE.has(token)).length
}

function streetOrdinal(street: string): number {
  return { preflop: 0, flop: 1, turn: 2, river: 3 }[street] ?? -1
}

function expectedStreetForBoard(board: Card[]): string {
  if (board.length >= 5) return 'river'
  if (board.length === 4) return 'turn'
  if (board.length === 3) return 'flop'
  return 'preflop'
}

// A couple of runout cards spread across the remaining deck, so the walk
// crosses every street while staying finite.
function pickRunouts(board: Card[], n: number): Card[] {
  const used = new Set(board.map(cardToNumber))
  const deck = createDeck().filter(c => !used.has(cardToNumber(c)))
  return Array.from({ length: n }, (_, i) =>
    deck[Math.min(deck.length - 1, Math.floor((i * deck.length) / n))]
  )
}

function walkTree(config: TreeConfig): WalkResult {
  const failures = {
    chip_conservation: [],
    non_negative_stacks: [],
    zero_sum_payoffs: [],
    street_progression: [],
    street_contributed: [],
    action_legality: [],
    raise_cap: [],
    all_in_behavior: [],
  } as Record<Invariant, Failure[]>

  let nodeCount = 0
  let maxDepth = 0
  let aborted: string | null = null

  const fail = (name: Invariant, node: GameNode, detail: string) => {
    if (failures[name].length < 5) {
      failures[name].push({ history: node.history || '(root)', detail })
    }
  }

  const check = (node: GameNode, parent: GameNode | null) => {
    const contributedSum = node.contributed[0] + node.contributed[1]
    if (Math.abs(contributedSum - node.pot) > EPS) {
      fail('chip_conservation', node, `pot=${node.pot} but contributed sums to ${contributedSum}`)
    }
    for (const p of [0, 1]) {
      // The root seeds contributed from the starting pot without taking those
      // chips out of stack, so each player's total is stack + pot/2.
      const expected = STARTING_STACK + STARTING_POT / 2
      const actual = node.stack[p] + node.contributed[p]
      if (Math.abs(actual - expected) > EPS) {
        fail('chip_conservation', node, `player ${p}: stack+contributed=${actual}, expected ${expected}`)
      }
      if (node.stack[p] < -EPS) {
        fail('non_negative_stacks', node, `player ${p} stack=${node.stack[p]}`)
      }
      if (node.streetContributed[p] > node.contributed[p] + EPS) {
        fail('street_contributed', node, `player ${p} streetContributed exceeds contributed`)
      }
    }

    if (node.payoff) {
      const sum = node.payoff[0] + node.payoff[1]
      if (Math.abs(sum) > EPS) {
        fail('zero_sum_payoffs', node, `payoff=[${node.payoff}] sums to ${sum}`)
      }
    }

    const expectedStreet = expectedStreetForBoard(node.board)
    if (node.street !== expectedStreet) {
      fail('street_progression', node, `street="${node.street}" but board has ${node.board.length} cards`)
    }
    if (parent && streetOrdinal(node.street) < streetOrdinal(parent.street)) {
      fail('street_progression', node, `street regressed from "${parent.street}" to "${node.street}"`)
    }
    if (node.isChance && node.street === 'river') {
      fail('street_progression', node, 'isChance on the river')
    }
    if (parent?.isChance) {
      if (Math.abs(node.streetContributed[0]) > EPS || Math.abs(node.streetContributed[1]) > EPS) {
        fail('street_contributed', node, `not reset after advanceStreet: [${node.streetContributed}]`)
      }
    }

    if (node.isTerminal || node.isChance) return

    const toCall = node.streetContributed[1 - node.player] - node.streetContributed[node.player]
    const has = (a: string) => node.actions.includes(a)

    if (node.actions.length === 0) {
      fail('action_legality', node, `no actions on a live decision node (player ${node.player})`)
    }
    if (has('check') && has('call')) {
      fail('action_legality', node, `both check and call offered: [${node.actions}]`)
    }
    if (toCall <= EPS) {
      if (!has('check')) fail('action_legality', node, `nothing owed (${toCall}) but no check: [${node.actions}]`)
      if (has('fold') || has('call')) fail('action_legality', node, `nothing owed (${toCall}) but fold/call offered`)
    } else {
      if (!has('fold') || !has('call')) fail('action_legality', node, `${toCall} owed but fold/call missing`)
      if (has('check')) fail('action_legality', node, `${toCall} owed but check offered`)
    }

    const aggressiveSoFar = aggressiveCountInStreet(node.history)
    if (aggressiveSoFar > config.maxAggressiveActions) {
      fail('raise_cap', node, `${aggressiveSoFar} aggressive actions this street`)
    }
    if (aggressiveSoFar >= config.maxAggressiveActions) {
      const offered = node.actions.filter(a => AGGRESSIVE.has(a))
      if (offered.length > 0) fail('raise_cap', node, `at cap but still offers [${offered}]`)
    }

    if (node.stack[node.player] <= EPS) {
      const offered = node.actions.filter(a => AGGRESSIVE.has(a))
      if (offered.length > 0) {
        fail('all_in_behavior', node, `stack=${node.stack[node.player]} but offered [${offered}]`)
      }
    }
  }

  const walk = (node: GameNode, parent: GameNode | null, depth: number) => {
    nodeCount++
    if (nodeCount > NODE_CAP) throw new RangeError(`node cap ${NODE_CAP} exceeded`)
    maxDepth = Math.max(maxDepth, depth)

    check(node, parent)
    if (node.isTerminal) return

    if (node.isChance) {
      for (const card of pickRunouts(node.board, 2)) {
        walk(advanceStreet(node, card), node, depth + 1)
      }
      return
    }

    for (const action of node.actions) {
      walk(applyAction(node, action), node, depth + 1)
    }
  }

  try {
    walk(createInitialNode(STARTING_STACK, STARTING_POT, BOARD, config), null, 0)
  } catch (e) {
    aborted = e instanceof Error ? e.message : String(e)
  }

  return { failures, nodeCount, maxDepth, aborted }
}

// Both shipped configs get walked: the lean default the solver now uses, and
// the rich five-size tree kept for comparison. A change that only holds for one
// of them is a change that will surprise someone.
describe.each([
  ['default (3 sizes)', DEFAULT_TREE_CONFIG],
  ['rich (5 sizes)', RICH_TREE_CONFIG],
])('game tree invariants - %s', (_label, config) => {
  let result: WalkResult

  beforeAll(() => {
    result = walkTree(config)
  })

  const report = (name: Invariant) =>
    result.failures[name]
      .map(f => `  history="${f.history}"\n    ${f.detail}`)
      .join('\n')

  it('terminates without hitting the node cap or overflowing the stack', () => {
    expect(result.aborted).toBeNull()
    expect(result.nodeCount).toBeGreaterThan(1000)
  })

  const invariants: Invariant[] = [
    'chip_conservation',
    'non_negative_stacks',
    'zero_sum_payoffs',
    'street_progression',
    'street_contributed',
    'action_legality',
    'raise_cap',
    'all_in_behavior',
  ]

  invariants.forEach(name => {
    it(`holds: ${name}`, () => {
      expect(result.failures[name].length, `\n${report(name)}`).toBe(0)
    })
  })
})
