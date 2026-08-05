export enum Suit {
  Clubs = 0,
  Diamonds = 1,
  Hearts = 2,
  Spades = 3,
}

export enum Rank {
  Two = 0,
  Three = 1,
  Four = 2,
  Five = 3,
  Six = 4,
  Seven = 5,
  Eight = 6,
  Nine = 7,
  Ten = 8,
  Jack = 9,
  Queen = 10,
  King = 11,
  Ace = 12,
}

export interface Card {
  rank: Rank
  suit: Suit
}

export const RANK_CHARS = '23456789TJQKA'
export const SUIT_CHARS = 'cdhs'

export function cardToString(card: Card): string {
  return RANK_CHARS[card.rank] + SUIT_CHARS[card.suit]
}

export function stringToCard(s: string): Card {
  if (s.length !== 2) throw new Error('Invalid card string')
  const rank = RANK_CHARS.indexOf(s[0].toUpperCase())
  const suit = SUIT_CHARS.indexOf(s[1].toLowerCase())
  if (rank === -1 || suit === -1) throw new Error('Invalid card string')
  return { rank, suit }
}

export function cardToNumber(card: Card): number {
  return card.rank * 4 + card.suit
}

export function numberToCard(n: number): Card {
  return {
    rank: Math.floor(n / 4) as Rank,
    suit: (n % 4) as Suit,
  }
}

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (let rank = 0; rank < 13; rank++) {
    for (let suit = 0; suit < 4; suit++) {
      deck.push({ rank: rank as Rank, suit: suit as Suit })
    }
  }
  return deck
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export function removeCards(deck: Card[], toRemove: Card[]): Card[] {
  const removeSet = new Set(toRemove.map(cardToNumber))
  return deck.filter(card => !removeSet.has(cardToNumber(card)))
}
