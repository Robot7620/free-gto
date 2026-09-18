import { Card, Rank, Suit, RANK_CHARS, cardToNumber } from './cards'
import { Range } from './range'
import { isPair, isSuited } from '../utils/poker'

export interface HandCombo {
  cards: [Card, Card]
  weight: number
}

// Expand a combo class ('AA', 'AKs', 'AKo') into every specific holding it
// represents: 6 for a pair, 4 suited, 12 offsuit.
export function expandCombo(combo: string): [Card, Card][] {
  const highRank = RANK_CHARS.indexOf(combo[0].toUpperCase()) as Rank
  const lowRank = RANK_CHARS.indexOf(combo[1].toUpperCase()) as Rank
  if (highRank < 0 || lowRank < 0) return []

  const holdings: [Card, Card][] = []

  if (isPair(combo)) {
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        holdings.push([
          { rank: highRank, suit: a as Suit },
          { rank: lowRank, suit: b as Suit },
        ])
      }
    }
  } else if (isSuited(combo)) {
    for (let suit = 0; suit < 4; suit++) {
      holdings.push([
        { rank: highRank, suit: suit as Suit },
        { rank: lowRank, suit: suit as Suit },
      ])
    }
  } else {
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        if (a === b) continue
        holdings.push([
          { rank: highRank, suit: a as Suit },
          { rank: lowRank, suit: b as Suit },
        ])
      }
    }
  }

  return holdings
}

// Every specific holding in a range, dropping any that use a blocked card
// (board cards, or the opponent's known holding).
export function enumerateRangeCombos(range: Range, blocked: Card[]): HandCombo[] {
  const blockedSet = new Set(blocked.map(cardToNumber))
  const combos: HandCombo[] = []

  range.getWeightedCombos().forEach(({ combo, weight }) => {
    expandCombo(combo).forEach(cards => {
      if (blockedSet.has(cardToNumber(cards[0])) || blockedSet.has(cardToNumber(cards[1]))) {
        return
      }
      combos.push({ cards, weight })
    })
  })

  return combos
}

// Sample one holding with probability proportional to its weight.
export function sampleCombo(combos: HandCombo[], rng: () => number = Math.random): HandCombo | null {
  let total = 0
  for (const c of combos) total += c.weight
  if (total <= 0) return null

  let target = rng() * total
  for (const c of combos) {
    target -= c.weight
    if (target <= 0) return c
  }
  return combos[combos.length - 1]
}

export function conflictsWith(cards: [Card, Card], blocked: Card[]): boolean {
  const blockedSet = new Set(blocked.map(cardToNumber))
  return blockedSet.has(cardToNumber(cards[0])) || blockedSet.has(cardToNumber(cards[1]))
}
