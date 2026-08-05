import React from 'react'
import { Card as CardType, RANK_CHARS, Suit } from '../engine/cards'

interface CardProps {
  card: CardType
  size?: 'sm' | 'md' | 'lg'
}

const suitSymbols = {
  [Suit.Clubs]: '♣',
  [Suit.Diamonds]: '♦',
  [Suit.Hearts]: '♥',
  [Suit.Spades]: '♠',
}

const suitColors = {
  [Suit.Clubs]: 'text-gray-900',
  [Suit.Diamonds]: 'text-red-600',
  [Suit.Hearts]: 'text-red-600',
  [Suit.Spades]: 'text-gray-900',
}

const sizes = {
  sm: 'w-12 h-16 text-sm',
  md: 'w-16 h-24 text-lg',
  lg: 'w-20 h-28 text-xl',
}

export const Card: React.FC<CardProps> = ({ card, size = 'md' }) => {
  const rankChar = RANK_CHARS[card.rank]
  const suitSymbol = suitSymbols[card.suit]
  const suitColor = suitColors[card.suit]

  return (
    <div
      className={`${sizes[size]} bg-white border-2 border-gray-300 rounded-lg shadow-md
        flex flex-col items-center justify-center font-bold ${suitColor}`}
    >
      <div className="text-center">
        <div>{rankChar}</div>
        <div className="-mt-1">{suitSymbol}</div>
      </div>
    </div>
  )
}
