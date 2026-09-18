import { describe, it, expect } from 'vitest'
import { stringToCard, Card } from '../../engine/cards'
import {
  createInitialNode,
  applyAction,
  advanceStreet,
  GameNode,
  TreeConfig,
  DEFAULT_TREE_CONFIG,
} from '../game-tree'
import { buildPublicTree, treeBytes, CHANCE, TERMINAL, PublicTree } from '../public-tree'

const BOARD = ['Ks', '9h', '4c'].map(stringToCard)

const DENSE: TreeConfig = {
  betFractions: [
    ['bet33', 0.33],
    ['bet50', 0.5],
    ['betpot', 1],
  ],
  maxAggressiveActions: 2,
}

// Walk the live recursive tree and the flat one together, asserting they agree
// at every node. The runout cards used here are deliberately NOT the
// placeholders the builder uses - the flat tree claims the betting structure
// doesn't depend on which card was dealt, and this is what checks that claim.
function compare(
  tree: PublicTree,
  stack: number,
  pot: number,
  board: Card[],
  config: TreeConfig,
  runouts: Card[]
): { nodes: number; maxDepth: number } {
  let nodes = 0
  let maxDepth = 0

  const walk = (node: GameNode, index: number, streetsDealt: number, depth: number) => {
    nodes++
    maxDepth = Math.max(maxDepth, depth)

    const where = `node ${index} (history "${node.history}")`

    expect(tree.pot[index], `pot at ${where}`).toBeCloseTo(node.pot, 9)
    expect(tree.atRisk[index], `atRisk at ${where}`).toBeCloseTo(
      Math.min(node.contributed[0], node.contributed[1]),
      9
    )
    expect(tree.street[index], `street at ${where}`).toBe(
      node.street === 'river' ? 3 : node.street === 'turn' ? 2 : 1
    )

    if (node.isTerminal) {
      expect(tree.player[index], `terminal at ${where}`).toBe(TERMINAL)
      if (node.payoff) {
        expect(tree.folder[index], `folder at ${where}`).toBe(
          node.payoff[0] < node.payoff[1] ? 0 : 1
        )
      } else {
        expect(tree.folder[index], `showdown should have no folder at ${where}`).toBe(-1)
      }
      return
    }

    if (node.isChance) {
      expect(tree.player[index], `chance at ${where}`).toBe(CHANCE)
      const card = runouts[streetsDealt % runouts.length]
      walk(advanceStreet(node, card), tree.chanceChild[index], streetsDealt + 1, depth + 1)
      return
    }

    expect(tree.player[index], `player at ${where}`).toBe(node.player)
    const start = tree.actionStart[index]
    expect(tree.actionCount[index], `action count at ${where}`).toBe(node.actions.length)
    expect(tree.actions.slice(start, start + node.actions.length), `actions at ${where}`).toEqual(
      node.actions
    )

    node.actions.forEach((action, i) => {
      walk(applyAction(node, action), tree.children[start + i], streetsDealt, depth + 1)
    })
  }

  walk(createInitialNode(stack, pot, board, config), 0, 0, 0)
  return { nodes, maxDepth }
}

describe('public tree', () => {
  it('matches the live tree node for node, with runouts the builder never saw', () => {
    const tree = buildPublicTree(100, 10, BOARD, DEFAULT_TREE_CONFIG)
    const runouts = ['Qd', '7h', 'Ad'].map(stringToCard)
    const { nodes } = compare(tree, 100, 10, BOARD, DEFAULT_TREE_CONFIG, runouts)
    expect(nodes).toBe(tree.nodeCount)
  })

  it('is the same structure whichever cards are dealt', () => {
    const tree = buildPublicTree(100, 10, BOARD, DEFAULT_TREE_CONFIG)
    // A completely different runout, including one that pairs the board.
    const runouts = ['2h', 'Kd', '5s'].map(stringToCard)
    const { nodes } = compare(tree, 100, 10, BOARD, DEFAULT_TREE_CONFIG, runouts)
    expect(nodes).toBe(tree.nodeCount)
  })

  it('matches for a denser config and a shorter stack', () => {
    const tree = buildPublicTree(40, 10, BOARD, DENSE)
    const runouts = ['Qd', '7h'].map(stringToCard)
    const { nodes } = compare(tree, 40, 10, BOARD, DENSE, runouts)
    expect(nodes).toBe(tree.nodeCount)
  })

  it('builds a turn and a river tree', () => {
    const turn = buildPublicTree(100, 10, ['Ks', '9h', '4c', '2d'].map(stringToCard))
    const river = buildPublicTree(100, 10, ['Ks', '9h', '4c', '2d', '7s'].map(stringToCard))

    expect(turn.nodeCount).toBeGreaterThan(river.nodeCount)
    // A river tree has no cards left to deal.
    expect([...river.player].some(p => p === CHANCE)).toBe(false)
    expect([...turn.player].some(p => p === CHANCE)).toBe(true)
  })

  it('every child index points somewhere real', () => {
    const tree = buildPublicTree(100, 10, BOARD)
    for (let i = 0; i < tree.children.length; i++) {
      expect(tree.children[i]).toBeGreaterThanOrEqual(0)
      expect(tree.children[i]).toBeLessThan(tree.nodeCount)
    }
    for (let i = 0; i < tree.nodeCount; i++) {
      if (tree.player[i] === CHANCE) {
        expect(tree.chanceChild[i]).toBeGreaterThanOrEqual(0)
        expect(tree.chanceChild[i]).toBeLessThan(tree.nodeCount)
      }
    }
  })

  it('is small enough to keep around', () => {
    const tree = buildPublicTree(100, 10, BOARD)
    // Reported so a regression that explodes the tree is visible in the log.
    console.log(
      `      flop tree: ${tree.nodeCount} nodes, ${tree.actions.length} action slots, ` +
        `${(treeBytes(tree) / 1024).toFixed(1)} KiB`
    )
    expect(treeBytes(tree)).toBeLessThan(5 * 1024 * 1024)
  })
})
