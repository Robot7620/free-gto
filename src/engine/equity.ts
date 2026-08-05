import { Card, createDeck, removeCards, shuffleDeck } from './cards'
import { evaluateHand, compareHands } from './evaluator'

export interface EquityResult {
  equity: number[]
  wins: number[]
  ties: number[]
  iterations: number
}

export function calculateEquity(
  hands: Card[][],
  board: Card[] = [],
  iterations: number = 10000
): EquityResult {
  const numPlayers = hands.length
  const wins = new Array(numPlayers).fill(0)
  const ties = new Array(numPlayers).fill(0)

  const deadCards = [...board, ...hands.flat()]
  let availableDeck = removeCards(createDeck(), deadCards)

  const cardsNeeded = 5 - board.length

  for (let i = 0; i < iterations; i++) {
    const deck = shuffleDeck(availableDeck)
    const fullBoard = [...board, ...deck.slice(0, cardsNeeded)]

    const handValues = hands.map(hand => evaluateHand([...hand, ...fullBoard]))

    let maxValue = handValues[0].value
    let winners: number[] = [0]

    for (let p = 1; p < numPlayers; p++) {
      const cmp = compareHands(handValues[p], { rank: handValues[0].rank, value: maxValue })
      if (cmp > 0) {
        maxValue = handValues[p].value
        winners = [p]
      } else if (cmp === 0) {
        winners.push(p)
      }
    }

    if (winners.length === 1) {
      wins[winners[0]]++
    } else {
      winners.forEach(w => ties[w]++)
    }
  }

  const equity = wins.map((w, i) => (w + ties[i] / 2) / iterations)

  return { equity, wins, ties, iterations }
}

export function calculateHandVsRange(
  hand: Card[],
  rangeHands: Card[][],
  board: Card[] = [],
  iterations: number = 1000
): number {
  let totalEquity = 0

  for (const villainHand of rangeHands) {
    const result = calculateEquity([hand, villainHand], board, iterations)
    totalEquity += result.equity[0]
  }

  return totalEquity / rangeHands.length
}
