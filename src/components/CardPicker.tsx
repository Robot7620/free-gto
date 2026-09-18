import React from 'react'
import { Card as CardType, Rank, Suit, RANK_CHARS, cardToNumber } from '../engine/cards'

interface CardPickerProps {
  selected: CardType[]
  onToggle: (card: CardType) => void
  maxCards?: number
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  [Suit.Clubs]: '♣',
  [Suit.Diamonds]: '♦',
  [Suit.Hearts]: '♥',
  [Suit.Spades]: '♠',
}

const SUIT_ORDER: Suit[] = [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs]

export const CardPicker: React.FC<CardPickerProps> = ({
  selected,
  onToggle,
  maxCards = 5,
}) => {
  const selectedSet = new Set(selected.map(cardToNumber))
  const isFull = selected.length >= maxCards

  return (
    <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
      {SUIT_ORDER.map(suit =>
        Array.from({ length: 13 }, (_, i) => {
          // Aces first, deuces last.
          const rank = (12 - i) as Rank
          const card = { rank, suit }
          const isSelected = selectedSet.has(cardToNumber(card))
          const isDisabled = isFull && !isSelected
          const isRed = suit === Suit.Hearts || suit === Suit.Diamonds

          return (
            <button
              key={`${rank}-${suit}`}
              onClick={() => onToggle(card)}
              disabled={isDisabled}
              className={`
                h-8 text-xs font-semibold border rounded
                ${isSelected
                  ? 'bg-blue-600 text-white border-blue-700'
                  : isDisabled
                    ? 'bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed'
                    : `bg-white ${isRed ? 'text-red-600' : 'text-gray-900'} border-gray-300 hover:bg-blue-50`
                }
              `}
              title={`${RANK_CHARS[rank]}${SUIT_SYMBOLS[suit]}`}
            >
              {RANK_CHARS[rank]}{SUIT_SYMBOLS[suit]}
            </button>
          )
        })
      )}
    </div>
  )
}
