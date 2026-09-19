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
import {
  buildPublicTree,
  chanceChildFor,
  treeBytes,
  CHANCE,
  TERMINAL,
  PublicTree,
} from '../public-tree'
import { runoutClass } from '../runout-class'

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
//
// With runout classes the claim is narrower and worth restating: the structure
// still doesn't depend on the card, but which *copy* of that structure you land
// in does. The walk routes through the class the real card falls into, so a
// mis-wired class pool shows up as a structural mismatch here.
function compare(
  tree: PublicTree,
  stack: number,
  pot: number,
  board: Card[],
  config: TreeConfig,
  runouts: Card[]
): { nodes: number; maxDepth: number; visited: Set<number> } {
  let nodes = 0
  let maxDepth = 0
  const visited = new Set<number>()

  const walk = (node: GameNode, index: number, streetsDealt: number, depth: number) => {
    visited.add(index)
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
      const cls = runoutClass(card, node.board, tree.classCount)
      walk(advanceStreet(node, card), chanceChildFor(tree, index, cls), streetsDealt + 1, depth + 1)
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
  return { nodes, maxDepth, visited }
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
    for (const k of [1, 4, 8]) {
      const tree = buildPublicTree(100, 10, BOARD, DEFAULT_TREE_CONFIG, k)
      for (let i = 0; i < tree.children.length; i++) {
        expect(tree.children[i]).toBeGreaterThanOrEqual(0)
        expect(tree.children[i]).toBeLessThan(tree.nodeCount)
      }
      let chanceNodes = 0
      for (let i = 0; i < tree.nodeCount; i++) {
        if (tree.player[i] !== CHANCE) {
          expect(tree.chanceStart[i], `node ${i} is not a chance node`).toBe(-1)
          continue
        }
        chanceNodes++
        const seen = new Set<number>()
        for (let c = 0; c < k; c++) {
          const child = chanceChildFor(tree, i, c)
          expect(child).toBeGreaterThanOrEqual(0)
          expect(child).toBeLessThan(tree.nodeCount)
          seen.add(child)
        }
        // Classes must not share a subtree, or they share regrets and the
        // whole exercise is a no-op.
        expect(seen.size, `chance node ${i} at K=${k}`).toBe(k)
      }
      expect(chanceNodes).toBeGreaterThan(0)
      expect(tree.chanceChildren.length).toBe(chanceNodes * k)
    }
  })

  it('gives each runout class its own copy, and one deal still sees one copy', () => {
    const unclassed = buildPublicTree(100, 10, BOARD, DEFAULT_TREE_CONFIG, 1)
    const runouts = ['Qd', '7h', 'Ad'].map(stringToCard)

    for (const k of [4, 8]) {
      const tree = buildPublicTree(100, 10, BOARD, DEFAULT_TREE_CONFIG, k)
      // A flop has two chance levels, so the turn is copied K times and the
      // river K*K - but the flop's own betting is shared, so growth lands
      // under K^2 rather than on it.
      expect(tree.nodeCount).toBeGreaterThan(unclassed.nodeCount)
      expect(tree.nodeCount).toBeLessThan(unclassed.nodeCount * k * k)

      // A single deal traverses exactly the structure the unclassed tree had.
      // That is the invariant that keeps per-iteration cost flat in K.
      const { nodes } = compare(tree, 100, 10, BOARD, DEFAULT_TREE_CONFIG, runouts)
      expect(nodes, `one runout through K=${k}`).toBe(unclassed.nodeCount)
    }
  })

  it('sends two turn classes down subtrees that share nothing below the flop', () => {
    // This is the property the whole exercise rests on. If a pairing turn and
    // an overcard turn shared any node below the chance point they would share
    // regrets there, and classing the runout would buy nothing.
    const tree = buildPublicTree(100, 10, BOARD, DEFAULT_TREE_CONFIG, 4)
    const pairing = compare(tree, 100, 10, BOARD, DEFAULT_TREE_CONFIG, ['Kd', '5d'].map(stringToCard))
    const overcard = compare(tree, 100, 10, BOARD, DEFAULT_TREE_CONFIG, ['Ad', '5d'].map(stringToCard))

    expect(runoutClass(stringToCard('Kd'), BOARD, 4)).toBe(0)
    expect(runoutClass(stringToCard('Ad'), BOARD, 4)).toBe(2)

    const shared = [...pairing.visited].filter(n => overcard.visited.has(n))
    // Everything they share is flop betting; nothing they share is past the
    // card that told them apart.
    for (const n of shared) expect(tree.street[n], `shared node ${n}`).toBe(1)
    // And they do share the flop, rather than being two disconnected walks.
    expect(shared.length).toBeGreaterThan(0)
    expect(shared.length).toBe([...pairing.visited].filter(n => tree.street[n] === 1).length)
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
