import { Card } from '../engine/cards'
import { Position, Street } from '../utils/poker'

export interface GameNode {
  id: string
  player: number
  pot: number
  stack: number[]
  street: Street
  board: Card[]
  history: string
  actions: string[]
  isTerminal: boolean
  payoff?: number[]
}

export function generateActions(
  pot: number,
  stack: number,
  toCall: number,
  canCheck: boolean
): string[] {
  const actions: string[] = []

  if (canCheck) {
    actions.push('check')
  } else {
    actions.push('fold')
    if (toCall > 0) {
      actions.push('call')
    }
  }

  const minBet = Math.max(toCall * 2, Math.min(stack, pot * 0.33))
  const maxBet = stack

  if (maxBet > 0) {
    const betSizes = [
      { label: 'bet33', size: pot * 0.33 },
      { label: 'bet50', size: pot * 0.5 },
      { label: 'bet75', size: pot * 0.75 },
      { label: 'betpot', size: pot },
      { label: 'allin', size: maxBet },
    ]

    betSizes.forEach(({ label, size }) => {
      if (size >= minBet && size <= maxBet) {
        actions.push(label)
      }
    })
  }

  return actions
}

export function createInitialNode(
  position: Position,
  stack: number,
  pot: number,
  board: Card[] = []
): GameNode {
  return {
    id: 'root',
    player: 0,
    pot,
    stack: [stack, stack],
    street: board.length === 0 ? 'preflop' : 'flop',
    board,
    history: '',
    actions: generateActions(pot, stack, 0, true),
    isTerminal: false,
  }
}

export function applyAction(node: GameNode, action: string): GameNode {
  const newHistory = node.history + (node.history ? '/' : '') + action
  const nextPlayer = (node.player + 1) % 2

  let newPot = node.pot
  let newStack = [...node.stack]
  let isTerminal = false
  let payoff: number[] | undefined

  if (action === 'fold') {
    isTerminal = true
    payoff = node.player === 0 ? [-node.stack[0], node.stack[0]] : [node.stack[1], -node.stack[1]]
  } else if (action === 'call') {
    const callAmount = Math.min(node.stack[node.player], node.pot / 2)
    newPot += callAmount
    newStack[node.player] -= callAmount
  } else if (action.startsWith('bet') || action === 'allin') {
    let betAmount = 0
    if (action === 'bet33') betAmount = node.pot * 0.33
    else if (action === 'bet50') betAmount = node.pot * 0.5
    else if (action === 'bet75') betAmount = node.pot * 0.75
    else if (action === 'betpot') betAmount = node.pot
    else if (action === 'allin') betAmount = node.stack[node.player]

    betAmount = Math.min(betAmount, node.stack[node.player])
    newPot += betAmount
    newStack[node.player] -= betAmount
  }

  const canCheck = action === 'check' || action === 'call'
  const toCall = action.startsWith('bet') || action === 'allin' ? newPot / 2 : 0

  return {
    id: newHistory,
    player: nextPlayer,
    pot: newPot,
    stack: newStack,
    street: node.street,
    board: node.board,
    history: newHistory,
    actions: isTerminal ? [] : generateActions(newPot, newStack[nextPlayer], toCall, canCheck),
    isTerminal,
    payoff,
  }
}
