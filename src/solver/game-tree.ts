import { Card, cardToString } from '../engine/cards'
import { Street } from '../utils/poker'

export interface TreeConfig {
  // Bet/raise sizes as a fraction of the pot after calling. All-in is always
  // available on top of these and isn't listed here.
  betFractions: [string, number][]
  // Cap on bets+raises per street, the way solver configs do. Without a cap the
  // tree only bottoms out when a stack empties.
  maxAggressiveActions: number
}

// Three sizes, 3-bet cap. Betting lines compound across three streets, so the
// size of this list drives the whole tree: five sizes puts the flop at ~30k
// betting lines and ~658k info sets, which cannot be sampled densely enough to
// converge. Commercial solvers prune to a similar handful - GTO Wizard measures
// a single-size river strategy at 0.05% of pot against the best alternative
// size, and 0.30% against an 8-size tree. See TODO.md.
export const DEFAULT_TREE_CONFIG: TreeConfig = {
  betFractions: [
    ['bet50', 0.5],
    ['betpot', 1],
  ],
  maxAggressiveActions: 3,
}

export interface GameNode {
  id: string
  player: number
  pot: number
  stack: number[]
  config: TreeConfig
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

// Sizing bets off pot fractions leaves float64 dust: after a few raises an
// amount that should be exactly 0 comes out as 1.4e-14. Compared exactly, that
// dust makes the tree offer fold/call where checking is free, and offer all-in
// to a player whose stack is already empty. Anything below this is zero.
const EPSILON = 1e-9

function snapToZero(x: number): number {
  return Math.abs(x) < EPSILON ? 0 : x
}

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
  toCall: number,
  config: TreeConfig = DEFAULT_TREE_CONFIG
): number {
  if (action === 'fold' || action === 'check') return 0
  if (action === 'call') return Math.min(stack, toCall)
  if (action === 'allin') return stack

  const fraction = config.betFractions.find(([label]) => label === action)?.[1]
  if (fraction === undefined) return 0

  // Size the raise off the pot as it would stand after the call.
  const raise = (pot + toCall) * fraction
  return Math.min(stack, toCall + raise)
}

export function generateActions(
  pot: number,
  stack: number,
  toCall: number,
  allowAggression: boolean = true,
  config: TreeConfig = DEFAULT_TREE_CONFIG
): string[] {
  const actions: string[] = []

  if (toCall > EPSILON) {
    actions.push('fold')
    actions.push('call')
  } else {
    actions.push('check')
  }

  if (allowAggression && stack > toCall + EPSILON) {
    config.betFractions.forEach(([label]) => {
      const cost = actionCost(label, pot, stack, toCall, config)
      const raise = cost - toCall
      // Must be a legal raise (at least matching what's owed) and leave the
      // actor with chips behind - otherwise it's just an all-in.
      if (raise >= Math.max(toCall, 0) - EPSILON && raise > EPSILON && cost < stack - EPSILON) {
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
  board: Card[] = [],
  config: TreeConfig = DEFAULT_TREE_CONFIG
): GameNode {
  return {
    id: 'root',
    player: FIRST_TO_ACT,
    pot,
    stack: [stack, stack],
    config,
    // The starting pot came from earlier streets, split evenly.
    contributed: [pot / 2, pot / 2],
    streetContributed: [0, 0],
    street: streetForBoard(board),
    board,
    history: '',
    actions: generateActions(pot, stack, 0, true, config),
    isTerminal: false,
    isChance: false,
  }
}

// Deal the next board card and open a fresh betting round on it.
export function advanceStreet(node: GameNode, card: Card): GameNode {
  const board = [...node.board, card]
  const street = streetForBoard(board)
  const history = `${node.history}|${cardToString(card)}:`

  // Once both stacks are empty there is nothing left to decide - the rest of
  // the board just runs out. Skipping the forced check/check rounds keeps the
  // tree from carrying a long tail of nodes with a single legal action; they
  // were ~12% of flop lines.
  const allIn = node.stack[0] <= EPSILON && node.stack[1] <= EPSILON

  return {
    id: history,
    player: FIRST_TO_ACT,
    pot: node.pot,
    stack: [...node.stack],
    config: node.config,
    contributed: [...node.contributed],
    // New betting round: nobody owes anything yet.
    streetContributed: [0, 0],
    street,
    board,
    history,
    actions: allIn ? [] : generateActions(node.pot, node.stack[FIRST_TO_ACT], 0, true, node.config),
    isTerminal: allIn && street === 'river',
    isChance: allIn && street !== 'river',
  }
}

export function applyAction(node: GameNode, action: string): GameNode {
  const player = node.player
  const opponent = 1 - player
  const separator = node.history === '' || node.history.endsWith(':') ? '' : '/'
  const newHistory = node.history + separator + action
  const toCall = snapToZero(
    Math.max(0, node.streetContributed[opponent] - node.streetContributed[player])
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
    const cost = actionCost(action, node.pot, node.stack[player], toCall, node.config)
    newStack[player] = snapToZero(newStack[player] - cost)
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

  const nextToCall = snapToZero(
    Math.max(0, newStreetContributed[player] - newStreetContributed[opponent])
  )

  return {
    id: newHistory,
    player: opponent,
    pot: newPot,
    stack: newStack,
    config: node.config,
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
            countAggressiveActions(newHistory) < node.config.maxAggressiveActions,
            node.config
          ),
    isTerminal,
    isChance,
    payoff,
  }
}
