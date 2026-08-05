import { Card, Rank, Suit } from './cards'

export enum HandRank {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

export interface HandValue {
  rank: HandRank
  value: number
}

function countRanks(cards: Card[]): number[] {
  const counts = new Array(13).fill(0)
  for (const card of cards) {
    counts[card.rank]++
  }
  return counts
}

function countSuits(cards: Card[]): number[] {
  const counts = new Array(4).fill(0)
  for (const card of cards) {
    counts[card.suit]++
  }
  return counts
}

function isFlush(cards: Card[]): boolean {
  const suitCounts = countSuits(cards)
  return suitCounts.some(count => count >= 5)
}

function getFlushSuit(cards: Card[]): Suit | null {
  const suitCounts = countSuits(cards)
  for (let suit = 0; suit < 4; suit++) {
    if (suitCounts[suit] >= 5) return suit as Suit
  }
  return null
}

function isStraight(cards: Card[]): { isStraight: boolean; highRank: Rank | null } {
  const ranks = new Set(cards.map(c => c.rank))

  // Check wheel (A-2-3-4-5)
  if (ranks.has(Rank.Ace) && ranks.has(Rank.Two) && ranks.has(Rank.Three) &&
      ranks.has(Rank.Four) && ranks.has(Rank.Five)) {
    return { isStraight: true, highRank: Rank.Five }
  }

  // Check other straights
  for (let high = Rank.Ace; high >= Rank.Five; high--) {
    let consecutive = 0
    for (let r = high; r >= 0 && consecutive < 5; r--) {
      if (ranks.has(r as Rank)) {
        consecutive++
      } else {
        break
      }
    }
    if (consecutive >= 5) {
      return { isStraight: true, highRank: high as Rank }
    }
  }

  return { isStraight: false, highRank: null }
}

function getRankGroups(cards: Card[]): { quads: Rank[], trips: Rank[], pairs: Rank[], singles: Rank[] } {
  const rankCounts = countRanks(cards)
  const quads: Rank[] = []
  const trips: Rank[] = []
  const pairs: Rank[] = []
  const singles: Rank[] = []

  for (let rank = Rank.Ace; rank >= Rank.Two; rank--) {
    const count = rankCounts[rank]
    if (count === 4) quads.push(rank)
    else if (count === 3) trips.push(rank)
    else if (count === 2) pairs.push(rank)
    else if (count === 1) singles.push(rank)
  }

  return { quads, trips, pairs, singles }
}

export function evaluateHand(cards: Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error('Hand must contain 5-7 cards')
  }

  const groups = getRankGroups(cards)
  const flush = isFlush(cards)
  const { isStraight: straight, highRank: straightHigh } = isStraight(cards)

  // Straight Flush
  if (flush && straight) {
    const flushSuit = getFlushSuit(cards)!
    const flushCards = cards.filter(c => c.suit === flushSuit)
    const { isStraight: flushStraight, highRank: flushStraightHigh } = isStraight(flushCards)
    if (flushStraight) {
      return {
        rank: HandRank.StraightFlush,
        value: (HandRank.StraightFlush << 20) | (flushStraightHigh! << 16),
      }
    }
  }

  // Four of a Kind
  if (groups.quads.length > 0) {
    const quadRank = groups.quads[0]
    const kicker = [...groups.trips, ...groups.pairs, ...groups.singles][0]
    return {
      rank: HandRank.FourOfAKind,
      value: (HandRank.FourOfAKind << 20) | (quadRank << 16) | (kicker << 12),
    }
  }

  // Full House
  if (groups.trips.length > 0 && (groups.pairs.length > 0 || groups.trips.length > 1)) {
    const tripRank = groups.trips[0]
    const pairRank = groups.trips.length > 1 ? groups.trips[1] : groups.pairs[0]
    return {
      rank: HandRank.FullHouse,
      value: (HandRank.FullHouse << 20) | (tripRank << 16) | (pairRank << 12),
    }
  }

  // Flush
  if (flush) {
    const flushSuit = getFlushSuit(cards)!
    const flushCards = cards.filter(c => c.suit === flushSuit)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 5)
    let value = HandRank.Flush << 20
    for (let i = 0; i < 5; i++) {
      value |= flushCards[i].rank << (16 - i * 4)
    }
    return { rank: HandRank.Flush, value }
  }

  // Straight
  if (straight) {
    return {
      rank: HandRank.Straight,
      value: (HandRank.Straight << 20) | (straightHigh! << 16),
    }
  }

  // Three of a Kind
  if (groups.trips.length > 0) {
    const tripRank = groups.trips[0]
    const kickers = [...groups.pairs, ...groups.singles].slice(0, 2)
    return {
      rank: HandRank.ThreeOfAKind,
      value: (HandRank.ThreeOfAKind << 20) | (tripRank << 16) |
             (kickers[0] << 12) | (kickers[1] << 8),
    }
  }

  // Two Pair
  if (groups.pairs.length >= 2) {
    const pair1 = groups.pairs[0]
    const pair2 = groups.pairs[1]
    const kicker = [...groups.pairs.slice(2), ...groups.singles][0]
    return {
      rank: HandRank.TwoPair,
      value: (HandRank.TwoPair << 20) | (pair1 << 16) | (pair2 << 12) | (kicker << 8),
    }
  }

  // Pair
  if (groups.pairs.length > 0) {
    const pairRank = groups.pairs[0]
    const kickers = groups.singles.slice(0, 3)
    return {
      rank: HandRank.Pair,
      value: (HandRank.Pair << 20) | (pairRank << 16) |
             (kickers[0] << 12) | (kickers[1] << 8) | (kickers[2] << 4),
    }
  }

  // High Card
  const kickers = groups.singles.slice(0, 5)
  let value = HandRank.HighCard << 20
  for (let i = 0; i < 5; i++) {
    value |= kickers[i] << (16 - i * 4)
  }
  return { rank: HandRank.HighCard, value }
}

export function compareHands(a: HandValue, b: HandValue): number {
  return a.value - b.value
}
