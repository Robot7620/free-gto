import React from 'react'
import { Card as CardType } from '../engine/cards'
import { Card } from './Card'

interface BoardViewProps {
  board: CardType[]
  label?: string
}

export const BoardView: React.FC<BoardViewProps> = ({ board, label = 'Board' }) => {
  return (
    <div className="bg-poker-felt p-6 rounded-lg shadow-lg">
      <h3 className="text-white text-lg font-semibold mb-4">{label}</h3>
      <div className="flex gap-2">
        {board.length === 0 ? (
          <div className="text-gray-300 text-sm">No cards dealt</div>
        ) : (
          board.map((card, idx) => <Card key={idx} card={card} size="md" />)
        )}
      </div>
    </div>
  )
}
