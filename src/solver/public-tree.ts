import { Card, stringToCard } from '../engine/cards'
import {
  GameNode,
  TreeConfig,
  DEFAULT_TREE_CONFIG,
  createInitialNode,
  applyAction,
  advanceStreet,
} from './game-tree'

// The betting tree, enumerated once into flat arrays.
//
// The solver currently rebuilds this from scratch on every iteration even
// though it doesn't depend on the hands at all - applyAction allocates five
// objects per node and generateActions allocates and scans on top of that.
//
// The structure is also independent of *which* runout card is dealt: pot,
// stacks and the legal actions after a turn card are the same whatever that
// card was. Only hand evaluation cares about the card's identity.
//
// That independence is why a chance node can have a handful of successors
// rather than 47. It does not follow that one successor is enough: the *betting
// structure* below a turn card is the same whatever fell, but the strategy that
// should be played there is not, and with a single successor the solver has
// nowhere to record the difference. So a chance node gets one structurally
// identical copy of the rest of the tree per runout class (see
// runout-class.ts), and the solver routes the card it dealt to its class.
// classCount = 1 is the old single-successor tree exactly.

export const CHANCE = -1
export const TERMINAL = -2

export interface PublicTree {
  nodeCount: number
  // CHANCE, TERMINAL, or the player to act.
  player: Int8Array
  // 1 flop, 2 turn, 3 river.
  street: Int8Array
  pot: Float64Array
  // At a terminal: the chips the loser matched, i.e. what changes hands.
  atRisk: Float64Array
  // At a fold terminal: who folded. -1 at showdowns, which need the hands.
  folder: Int8Array
  // Slice of `actions` / `children` belonging to this node.
  actionStart: Int32Array
  actionCount: Int32Array
  // How many runout classes a chance node branches on. 1 is the unclassed tree.
  classCount: number
  // For a chance node, where its slice of `chanceChildren` starts; -1 otherwise.
  chanceStart: Int32Array
  // Flat pool of `classCount` successors per chance node, indexed by class.
  chanceChildren: Int32Array
  // Flat pools, indexed by actionStart + i.
  actions: string[]
  children: Int32Array
  config: TreeConfig
}

// Structure only - the identity of these never reaches the flat tree, they
// just move the street along so board length advances.
const PLACEHOLDER_RUNOUTS = ['2c', '3c'].map(stringToCard)

export function buildPublicTree(
  stack: number,
  pot: number,
  board: Card[],
  config: TreeConfig = DEFAULT_TREE_CONFIG,
  classCount = 1
): PublicTree {
  if (!Number.isInteger(classCount) || classCount < 1) {
    throw new Error(`classCount must be a positive integer, got ${classCount}`)
  }
  const player: number[] = []
  const street: number[] = []
  const potArr: number[] = []
  const atRisk: number[] = []
  const folder: number[] = []
  const actionStart: number[] = []
  const actionCount: number[] = []
  const chanceStart: number[] = []
  const chanceChildren: number[] = []
  const actions: string[] = []
  const children: number[] = []

  const streetIndex = (s: GameNode['street']): number =>
    s === 'river' ? 3 : s === 'turn' ? 2 : 1

  const add = (node: GameNode): number => {
    const index = player.length

    player.push(node.isTerminal ? TERMINAL : node.isChance ? CHANCE : node.player)
    street.push(streetIndex(node.street))
    potArr.push(node.pot)
    atRisk.push(Math.min(node.contributed[0], node.contributed[1]))
    actionStart.push(actions.length)
    actionCount.push(0)
    chanceStart.push(-1)

    // A fold's payoff is settled from the contributions, not the hands, so the
    // only thing the solver needs later is who folded.
    if (node.isTerminal && node.payoff) {
      folder.push(node.payoff[0] < node.payoff[1] ? 0 : 1)
    } else {
      folder.push(-1)
    }

    return index
  }

  const walk = (node: GameNode, depth: number): number => {
    const index = add(node)

    if (node.isTerminal) return index

    if (node.isChance) {
      // Placeholder card: only the street advance matters here. Every class
      // gets the same structure - what differs between them is the strategy
      // the solver will store against it, not the betting.
      const card = PLACEHOLDER_RUNOUTS[Math.min(depth, PLACEHOLDER_RUNOUTS.length - 1)]
      // Reserve the slice before recursing, as with actions below.
      const start = chanceChildren.length
      for (let c = 0; c < classCount; c++) chanceChildren.push(-1)
      chanceStart[index] = start
      for (let c = 0; c < classCount; c++) {
        chanceChildren[start + c] = walk(advanceStreet(node, card), depth + 1)
      }
      return index
    }

    // Reserve the slice before recursing, since children append to the pools.
    const start = actions.length
    const nodeActions = node.actions
    for (const action of nodeActions) {
      actions.push(action)
      children.push(-1)
    }
    actionStart[index] = start
    actionCount[index] = nodeActions.length

    nodeActions.forEach((action, i) => {
      children[start + i] = walk(applyAction(node, action), depth)
    })

    return index
  }

  walk(createInitialNode(stack, pot, board, config), 0)

  return {
    nodeCount: player.length,
    player: Int8Array.from(player),
    street: Int8Array.from(street),
    pot: Float64Array.from(potArr),
    atRisk: Float64Array.from(atRisk),
    folder: Int8Array.from(folder),
    actionStart: Int32Array.from(actionStart),
    actionCount: Int32Array.from(actionCount),
    classCount,
    chanceStart: Int32Array.from(chanceStart),
    chanceChildren: Int32Array.from(chanceChildren),
    actions,
    children: Int32Array.from(children),
    config,
  }
}

// Rough in-memory size, for sizing decisions.
// The successor a chance node takes for a given runout class.
export function chanceChildFor(tree: PublicTree, node: number, cls: number): number {
  const start = tree.chanceStart[node]
  if (start < 0) throw new Error(`node ${node} is not a chance node`)
  if (cls < 0 || cls >= tree.classCount) {
    throw new Error(`runout class ${cls} is outside 0..${tree.classCount - 1}`)
  }
  return tree.chanceChildren[start + cls]
}

export function treeBytes(tree: PublicTree): number {
  return (
    tree.player.byteLength +
    tree.street.byteLength +
    tree.pot.byteLength +
    tree.atRisk.byteLength +
    tree.folder.byteLength +
    tree.actionStart.byteLength +
    tree.actionCount.byteLength +
    tree.chanceStart.byteLength +
    tree.chanceChildren.byteLength +
    tree.children.byteLength
  )
}
