import { Card, cardToString } from '../engine/cards'
import { Street } from '../utils/poker'

export interface GameNode {
  id: string
  player: number
  pot: number
  stack: number[]
  // Total chips each player has put in across the whole hand. Payoffs settle
  // against these.
  contributed: number[]
  // Chips each player has put in during the current betting round only. This
  // is what "amount to call" is derived from, so it resets every street.
  streetContributed: number[]
  street: Street
  board: Card[]
  history: string
  actions: string[]
  isTerminal: boolean
  // Betting closed before the river: the next card has to be dealt before
  // play continues.
  isChance: boolean
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

// Streets are separated by '|' in the history, so the current round's actions
// are whatever follows the last separator.
function currentStreetHistory(history: string): string {
  const segment = history.split('|').pop() ?? ''
  // A street segment starts with the runout card, e.g. "Kd:check/bet50".
  return segment.includes(':') ? segment.slice(segment.indexOf(':') + 1) : segment
}

function countAggressiveActions(history: string): number {
  const segment = currentStreetHistory(history)
  if (!segment) return 0
  return segment
    .split('/')
    .filter(a => a.startsWith('bet') || a === 'allin')
    .length
}

export function streetForBoard(board: Card[]): Street {
  if (board.length >= 5) return 'river'
  if (board.length === 4) return 'turn'
  if (board.length === 3) return 'flop'
  return 'preflop'
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

// Out of position (player 1) acts first on every postflop street.
const FIRST_TO_ACT = 1

export function createInitialNode(
  stack: number,
  pot: number,
  board: Card[] = []
): GameNode {
  return {
    id: 'root',
    player: FIRST_TO_ACT,
    pot,
    stack: [stack, stack],
    // The starting pot came from earlier streets, split evenly.
    contributed: [pot / 2, pot / 2],
    streetContributed: [0, 0],
    street: streetForBoard(board),
    board,
    history: '',
    actions: generateActions(pot, stack, 0),
    isTerminal: false,
    isChance: false,
  }
}

// Deal the next board card and open a fresh betting round on it.
export function advanceStreet(node: GameNode, card: Card): GameNode {
  const board = [...node.board, card]
  const history = `${node.history}|${cardToString(card)}:`

  return {
    id: history,
    player: FIRST_TO_ACT,
    pot: node.pot,
    stack: [...node.stack],
    contributed: [...node.contributed],
    // New betting round: nobody owes anything yet.
    streetContributed: [0, 0],
    street: streetForBoard(board),
    board,
    history,
    actions: generateActions(node.pot, node.stack[FIRST_TO_ACT], 0),
    isTerminal: false,
    isChance: false,
  }
}

export function applyAction(node: GameNode, action: string): GameNode {
  const player = node.player
  const opponent = 1 - player
  const separator = node.history === '' || node.history.endsWith(':') ? '' : '/'
  const newHistory = node.history + separator + action
  const toCall = Math.max(
    0,
    node.streetContributed[opponent] - node.streetContributed[player]
  )

  const newStack = [...node.stack]
  const newContributed = [...node.contributed]
  const newStreetContributed = [...node.streetContributed]
  let newPot = node.pot
  let isTerminal = false
  let isChance = false
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
    newStreetContributed[player] += cost
    newPot += cost

    // A call closes the round, as does a check behind another check.
    const streetActions = currentStreetHistory(node.history).split('/').filter(Boolean)
    const lastAction = streetActions[streetActions.length - 1]
    const roundClosed =
      action === 'call' || (action === 'check' && lastAction === 'check')

    if (roundClosed) {
      // River means showdown; otherwise the next card gets dealt. Payoff is
      // left unset either way so cfr.ts settles it against the hands.
      if (node.street === 'river') {
        isTerminal = true
      } else {
        isChance = true
      }
    }
  }

  const nextToCall = Math.max(
    0,
    newStreetContributed[player] - newStreetContributed[opponent]
  )

  return {
    id: newHistory,
    player: opponent,
    pot: newPot,
    stack: newStack,
    contributed: newContributed,
    streetContributed: newStreetContributed,
    street: node.street,
    board: node.board,
    history: newHistory,
    actions:
      isTerminal || isChance
        ? []
        : generateActions(
            newPot,
            newStack[opponent],
            nextToCall,
            countAggressiveActions(newHistory) < MAX_AGGRESSIVE_ACTIONS
          ),
    isTerminal,
    isChance,
    payoff,
  }
}
