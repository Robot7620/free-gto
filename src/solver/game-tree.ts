import { Card } from '../engine/cards'
import { Street } from '../utils/poker'

export interface GameNode {
  id: string
  player: number
  pot: number
  stack: number[]
  // Chips each player has put into the pot so far. Payoffs are settled
  // against these, so they have to stay in sync with pot/stack.
  contributed: number[]
  street: Street
  board: Card[]
  history: string
  actions: string[]
  isTerminal: boolean
  payoff?: number[]
}

const BET_FRACTIONS: [string, number][] = [
  ['bet33', 0.33],
  ['bet50', 0.5],
  ['bet75', 0.75],
  ['betpot', 1],
]

// Cap the betting escalation per street, the way solver configs do. Without a
// cap the tree only bottoms out when a stack empties, which explodes its size
// for no real strategic gain.
const MAX_AGGRESSIVE_ACTIONS = 3

function countAggressiveActions(history: string): number {
  if (!history) return 0
  return history
    .split('/')
    .filter(a => a.startsWith('bet') || a === 'allin')
    .length
}

// Chips the actor must add for a given bet/raise action.
export function actionCost(
  action: string,
  pot: number,
  stack: number,
  toCall: number
): number {
  if (action === 'fold' || action === 'check') return 0
  if (action === 'call') return Math.min(stack, toCall)
  if (action === 'allin') return stack

  const fraction = BET_FRACTIONS.find(([label]) => label === action)?.[1]
  if (fraction === undefined) return 0

  // Size the raise off the pot as it would stand after the call.
  const raise = (pot + toCall) * fraction
  return Math.min(stack, toCall + raise)
}

export function generateActions(
  pot: number,
  stack: number,
  toCall: number,
  allowAggression: boolean = true
): string[] {
  const actions: string[] = []

  if (toCall > 0) {
    actions.push('fold')
    actions.push('call')
  } else {
    actions.push('check')
  }

  if (allowAggression && stack > toCall) {
    BET_FRACTIONS.forEach(([label]) => {
      const cost = actionCost(label, pot, stack, toCall)
      const raise = cost - toCall
      // Must be a legal raise (at least matching what's owed) and leave the
      // actor with chips behind - otherwise it's just an all-in.
      if (raise >= Math.max(toCall, 0) && raise > 0 && cost < stack) {
        actions.push(label)
      }
    })
    actions.push('allin')
  }

  return actions
}

export function createInitialNode(
  stack: number,
  pot: number,
  board: Card[] = []
): GameNode {
  return {
    id: 'root',
    player: 0,
    pot,
    stack: [stack, stack],
    // The starting pot came from earlier streets, split evenly.
    contributed: [pot / 2, pot / 2],
    street: board.length === 0 ? 'preflop' : 'flop',
    board,
    history: '',
    actions: generateActions(pot, stack, 0),
    isTerminal: false,
  }
}

export function applyAction(node: GameNode, action: string): GameNode {
  const player = node.player
  const opponent = 1 - player
  const newHistory = node.history + (node.history ? '/' : '') + action
  const toCall = Math.max(0, node.contributed[opponent] - node.contributed[player])

  const newStack = [...node.stack]
  const newContributed = [...node.contributed]
  let newPot = node.pot
  let isTerminal = false
  let payoff: number[] | undefined

  if (action === 'fold') {
    // The folder forfeits what they put in; the opponent can only win what
    // they actually matched, so anything above that comes back to them.
    const atRisk = Math.min(node.contributed[player], node.contributed[opponent])
    isTerminal = true
    payoff = []
    payoff[player] = -atRisk
    payoff[opponent] = atRisk
  } else {
    const cost = actionCost(action, node.pot, node.stack[player], toCall)
    newStack[player] -= cost
    newContributed[player] += cost
    newPot += cost

    // A call closes the action, as does a check behind another check.
    // Single-street model, so that means showdown - leave payoff unset so
    // cfr.ts settles it against the hands.
    const lastAction = node.history.split('/').pop()
    if (action === 'call') {
      isTerminal = true
    } else if (action === 'check' && lastAction === 'check') {
      isTerminal = true
    }
  }

  const nextToCall = Math.max(0, newContributed[player] - newContributed[opponent])

  return {
    id: newHistory,
    player: opponent,
    pot: newPot,
    stack: newStack,
    contributed: newContributed,
    street: node.street,
    board: node.board,
    history: newHistory,
    actions: isTerminal
      ? []
      : generateActions(
          newPot,
          newStack[opponent],
          nextToCall,
          countAggressiveActions(newHistory) < MAX_AGGRESSIVE_ACTIONS
        ),
    isTerminal,
    payoff,
  }
}
