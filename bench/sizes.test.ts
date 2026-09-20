import { describe, it } from 'vitest'
import { stringToCard } from '../src/engine/cards'
import { buildPublicTree, treeBytes } from '../src/solver/public-tree'
import { DEFAULT_TREE_CONFIG } from '../src/solver/game-tree'

const BOARDS = {
  flop: ['Ks', '9h', '4c'],
  turn: ['Ks', '9h', '4c', '2d'],
  river: ['Ks', '9h', '4c', '2d', '7s'],
}

describe('tree sizes', () => {
  it('reports node counts at each K', () => {
    for (const [name, cards] of Object.entries(BOARDS)) {
      const board = cards.map(stringToCard)
      for (const k of [1, 4, 8]) {
        const t = buildPublicTree(100, 10, board, DEFAULT_TREE_CONFIG, k)
        console.log(
          `${name} K=${k}: ${t.nodeCount} nodes, ${(treeBytes(t) / 1024).toFixed(1)} KiB`
        )
      }
    }
  })
})
