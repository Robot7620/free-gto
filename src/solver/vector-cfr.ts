import { Card, cardToNumber, createDeck, RANK_CHARS } from '../engine/cards'
import { Range } from '../engine/range'
import { enumerateRangeCombos } from '../engine/combos'
import { TreeConfig, DEFAULT_TREE_CONFIG } from './game-tree'
import { PublicTree, buildPublicTree, CHANCE, TERMINAL } from './public-tree'
import { ShowdownTable, buildShowdownTable } from './showdown-table'
import { HandSet, makeHandSet, showdownValues, foldValues, rankOrder } from './showdown-values'
import { Rng, makeRng } from './rng'

// Vectorized CFR over the public betting tree.
//
// The sampled solver in cfr.ts deals one holding to each player per iteration
// and keys its info sets on a hand-strength bucket. That bucket is draw-blind -
// A(s)5(s) on Ks9h4c and A(d)5(c) share it - so no amount of compute makes flop
// play right. This walks the public tree instead, carrying a vector of
// per-hand reach probabilities and counterfactual values, and updates every
// holding exactly on every iteration. Hole cards stay exact; only the betting
// tree and the runout are abstracted.
//
// What is still abstracted, and it matters: regrets are keyed on
// (public tree node, hand). The public tree node does not record WHICH card
// fell, so turn and river strategies are averaged over runouts. A river solve
// has no runouts left and is therefore exact - that is the correctness gate.
// See TODO.md for what lifting this would cost.

export interface VectorCFROptions {
  stack: number
  pot: number
  board: Card[]
  // [BTN / in position, BB / out of position]. Player 1 acts first postflop.
  ranges: [Range, Range]
  config?: TreeConfig
  seed?: number
  // A prebuilt table for this board, if one is already in hand. Building a flop
  // table is ~0.8s.
  table?: ShowdownTable
}

export interface HandVectors {
  count: number
  cards: [Card, Card][]
  // Range weight, which is also the reach probability at the root.
  weight: Float64Array
  set: HandSet
  // Row in the showdown table, so ranks can be refreshed per runout.
  tableIndex: Int32Array
  // Hands holding each card, for zeroing what a dealt runout card blocks.
  byCard: Int32Array[]
}

// Scratch space for the traversal. Every frame's vectors are the same handful
// of shapes and the recursion is strictly stack-ordered, so a bump allocator
// with a mark/release pair removes the per-node garbage entirely.
class Arena {
  private buf: Float64Array
  private top = 0

  constructor(size: number) {
    this.buf = new Float64Array(size)
  }

  mark(): number {
    return this.top
  }

  release(mark: number): void {
    this.top = mark
  }

  alloc(n: number): Float64Array {
    const start = this.top
    const end = start + n
    if (end > this.buf.length) {
      throw new Error(
        `vector-cfr scratch exhausted (${end} > ${this.buf.length} doubles); ` +
          'the tree is deeper or wider than the constructor estimated'
      )
    }
    this.top = end
    return this.buf.subarray(start, end)
  }

  get capacity(): number {
    return this.buf.length
  }
}

function pairKey(a: number, b: number): number {
  return a < b ? a * 52 + b : b * 52 + a
}

function runoutKey(cards: number[]): string {
  return [...cards].sort((x, y) => x - y).join(',')
}

// 'AA' / 'AKs' / 'AKo' for a holding, matching HAND_COMBOS.
export function comboClass(cards: [Card, Card]): string {
  const [x, y] = cards
  const hi = x.rank >= y.rank ? x : y
  const lo = x.rank >= y.rank ? y : x
  const label = RANK_CHARS[hi.rank] + RANK_CHARS[lo.rank]
  if (hi.rank === lo.rank) return label
  return label + (x.suit === y.suit ? 's' : 'o')
}

export class VectorCFR {
  readonly tree: PublicTree
  readonly table: ShowdownTable
  readonly hands: [HandVectors, HandVectors]

  // regret and strategySum are indexed by slotStart[node] + hand * actions + a.
  // The hand dimension uses whichever player acts at that node.
  private readonly slotStart: Int32Array
  private readonly regret: Float32Array
  // Float64 deliberately. Linear weighting makes this sum grow like T^2, and in
  // Float32 late increments would vanish into an accumulator that has already
  // outgrown them.
  private readonly strategySum: Float64Array

  private readonly arena: Arena
  private readonly rng: Rng
  private readonly rootStreet: number
  private readonly rootBoardLength: number
  private readonly runoutIndex: Map<string, number>
  private readonly deckAvailable: number[]

  private readonly rootOut: [Float64Array, Float64Array]

  // Holdings a dealt runout card has knocked out, for the rest of this
  // traversal. Zero reach is not enough to identify them: a live holding can
  // have zero reach because the player's own strategy never takes this line,
  // and CFR has to keep updating its regrets. See `chance`.
  private readonly dead: [Uint8Array, Uint8Array]
  private readonly deadList: [number[], number[]] = [[], []]

  // Per-iteration state, set before each traversal.
  private runoutCards: number[] = []
  // Rank order for the runout currently loaded. Recomputing it inside every
  // showdown terminal was most of the solver's running time; it only changes
  // when the ranks do, which is once per iteration in setRunout.
  private order: [Int32Array, Int32Array] = [new Int32Array(0), new Int32Array(0)]
  private updating = true
  private discount = 0.5
  private strategyWeight = 1

  private iterationsRun = 0

  constructor(options: VectorCFROptions) {
    const config = options.config ?? DEFAULT_TREE_CONFIG
    this.tree = buildPublicTree(options.stack, options.pot, options.board, config)
    this.table = options.table ?? buildShowdownTable(options.board)
    this.rng = makeRng(options.seed ?? 1)

    this.rootBoardLength = options.board.length
    this.rootStreet = options.board.length >= 5 ? 3 : options.board.length === 4 ? 2 : 1

    const tableRow = new Map<number, number>()
    this.table.hands.forEach(([a, b], i) => {
      tableRow.set(pairKey(cardToNumber(a), cardToNumber(b)), i)
    })

    this.hands = [
      this.buildHands(options.ranges[0], options.board, tableRow),
      this.buildHands(options.ranges[1], options.board, tableRow),
    ]

    this.runoutIndex = new Map()
    this.table.runouts.forEach((runout, i) => {
      this.runoutIndex.set(runoutKey(runout.map(cardToNumber)), i)
    })

    const onBoard = new Set(options.board.map(cardToNumber))
    this.deckAvailable = createDeck()
      .map(cardToNumber)
      .filter(n => !onBoard.has(n))

    // Lay out the regret and strategy pools.
    const tree = this.tree
    this.slotStart = new Int32Array(tree.nodeCount)
    let slots = 0
    for (let n = 0; n < tree.nodeCount; n++) {
      this.slotStart[n] = slots
      const p = tree.player[n]
      if (p === CHANCE || p === TERMINAL) continue
      slots += tree.actionCount[n] * this.hands[p].count
    }
    this.regret = new Float32Array(slots)
    this.strategySum = new Float64Array(slots)

    this.rootOut = [
      new Float64Array(this.hands[0].count),
      new Float64Array(this.hands[1].count),
    ]
    this.dead = [
      new Uint8Array(this.hands[0].count),
      new Uint8Array(this.hands[1].count),
    ]

    this.arena = new Arena(this.scratchBound())

    // A river board has no runout to sample, so ranks are fixed once.
    if (this.rootBoardLength === 5) this.setRunout([])
  }

  private buildHands(
    range: Range,
    board: Card[],
    tableRow: Map<number, number>
  ): HandVectors {
    const combos = enumerateRangeCombos(range, board)
    const count = combos.length
    if (count === 0) throw new Error('range is empty on this board')

    const cards = combos.map(c => c.cards)
    const weight = Float64Array.from(combos.map(c => c.weight))
    const pairs: [number, number][] = cards.map(([a, b]) => [
      cardToNumber(a),
      cardToNumber(b),
    ])

    const tableIndex = new Int32Array(count)
    pairs.forEach(([a, b], i) => {
      const row = tableRow.get(pairKey(a, b))
      if (row === undefined) throw new Error('holding is not in the showdown table')
      tableIndex[i] = row
    })

    const holders: number[][] = Array.from({ length: 52 }, () => [])
    pairs.forEach(([a, b], i) => {
      holders[a].push(i)
      holders[b].push(i)
    })

    return {
      count,
      cards,
      weight,
      set: makeHandSet(pairs, new Array(count).fill(0)),
      tableIndex,
      byCard: holders.map(list => Int32Array.from(list)),
    }
  }

  // Worst-case scratch for one root-to-leaf path. A decision frame holds the
  // strategy, one action value per action, a reach vector and the opponent's
  // child values; a chance frame holds a copy of both reach vectors.
  private scratchBound(): number {
    const tree = this.tree
    const depth = new Int32Array(tree.nodeCount)
    let maxDepth = 0
    let maxActions = 1
    for (let n = 0; n < tree.nodeCount; n++) {
      if (depth[n] > maxDepth) maxDepth = depth[n]
      const p = tree.player[n]
      if (p === CHANCE) {
        depth[tree.chanceChild[n]] = depth[n] + 1
        continue
      }
      if (p === TERMINAL) continue
      const count = tree.actionCount[n]
      if (count > maxActions) maxActions = count
      const start = tree.actionStart[n]
      for (let a = 0; a < count; a++) depth[tree.children[start + a]] = depth[n] + 1
    }

    const maxHands = Math.max(this.hands[0].count, this.hands[1].count)
    // A decision frame is the expensive one; charging every level for it and
    // doubling is cheaper than reasoning about how the two kinds interleave.
    const perFrame = (2 * maxActions + 3) * maxHands
    return 2 * (maxDepth + 2) * perFrame + 64
  }

  // Point the hand sets at a runout's column of the showdown table. Holdings
  // that use one of the runout's cards come back as CONFLICT; they are never
  // read, because such a hand has had its reach and value zeroed at the chance
  // node that dealt the card.
  private setRunout(cards: number[]): void {
    const column = this.runoutIndex.get(runoutKey(cards))
    if (column === undefined) throw new Error(`no showdown column for runout ${cards}`)
    this.runoutCards = cards

    const { ranks, handCount } = this.table
    const base = column * handCount
    for (const hands of this.hands) {
      const { count, tableIndex, set } = hands
      for (let h = 0; h < count; h++) set.rank[h] = ranks[base + tableIndex[h]]
    }
    this.order = [rankOrder(this.hands[0].set), rankOrder(this.hands[1].set)]
  }

  // Deal the remaining board one card at a time, each uniform over what's left.
  // Sampling the turn and river as an unordered pair instead would not be the
  // same thing: which card arrives first decides which holdings are still live
  // during turn betting, so the two orders are genuinely different traversals.
  private sampleRunout(): number[] {
    const needed = 5 - this.rootBoardLength
    if (needed === 0) return []
    const pool = this.deckAvailable.slice()
    const drawn: number[] = []
    for (let i = 0; i < needed; i++) {
      const pick = Math.floor(this.rng() * pool.length)
      drawn.push(pool[pick])
      pool[pick] = pool[pool.length - 1]
      pool.pop()
    }
    return drawn
  }

  get iterations(): number {
    return this.iterationsRun
  }

  run(iterations: number): void {
    for (let i = 0; i < iterations; i++) this.iterate(this.sampleRunout())
  }

  // One learning iteration on a runout of the caller's choosing, in the order
  // the cards are dealt. `run` is this with the runout sampled.
  runWithRunout(runout: Card[]): void {
    this.iterate(runout.map(cardToNumber))
  }

  private iterate(runout: number[]): void {
    this.iterationsRun++
    const t = this.iterationsRun
    // Linear CFR. Weighting iteration t's regret by t is equivalent to
    // discounting everything already accumulated by t/(t+1) and adding the new
    // regret unweighted, up to an overall positive factor that regret matching
    // is blind to. The discounted form is what keeps the running sum inside
    // Float32's precision, and it costs nothing here because the vectorized
    // traversal visits every decision node on every iteration.
    this.discount = t / (t + 1)
    this.strategyWeight = t
    this.updating = true
    this.setRunout(runout)
    this.walk(0, this.hands[0].weight, this.hands[1].weight, this.rootOut[0], this.rootOut[1])
  }

  // One traversal with a given runout and no learning, returning each player's
  // counterfactual values at the root under the current strategy. The solver
  // does not need this; it exists so the chance-node weighting can be checked
  // against a reference that enumerates runouts rather than sampling them.
  valuesForRunout(runout: Card[]): [Float64Array, Float64Array] {
    this.setRunout(runout.map(cardToNumber))
    this.updating = false
    const out: [Float64Array, Float64Array] = [
      new Float64Array(this.hands[0].count),
      new Float64Array(this.hands[1].count),
    ]
    this.walk(0, this.hands[0].weight, this.hands[1].weight, out[0], out[1])
    return out
  }

  // Reach-weighted value of the root for each player. These sum to zero: every
  // terminal is zero-sum over the pairs of holdings that can actually be dealt,
  // and nothing in the traversal breaks that symmetry.
  rootValues(): [number, number] {
    return [this.dot(0, this.rootOut[0]), this.dot(1, this.rootOut[1])]
  }

  private dot(player: number, values: Float64Array): number {
    const { count, weight } = this.hands[player]
    let total = 0
    for (let h = 0; h < count; h++) total += weight[h] * values[h]
    return total
  }

  private walk(
    node: number,
    reach0: Float64Array,
    reach1: Float64Array,
    out0: Float64Array,
    out1: Float64Array
  ): void {
    const kind = this.tree.player[node]
    if (kind === TERMINAL) return this.terminal(node, reach0, reach1, out0, out1)
    if (kind === CHANCE) return this.chance(node, reach0, reach1, out0, out1)
    return this.decision(node, kind, reach0, reach1, out0, out1)
  }

  private terminal(
    node: number,
    reach0: Float64Array,
    reach1: Float64Array,
    out0: Float64Array,
    out1: Float64Array
  ): void {
    const atRisk = this.tree.atRisk[node]
    const folder = this.tree.folder[node]
    const set0 = this.hands[0].set
    const set1 = this.hands[1].set

    if (folder === -1) {
      const [order0, order1] = this.order
      showdownValues(set0, set1, reach1, atRisk, out0, order0, order1)
      showdownValues(set1, set0, reach0, atRisk, out1, order1, order0)
      return
    }

    // The folder forfeits what they matched; the other player collects it.
    foldValues(set0, set1, reach1, folder === 0 ? -atRisk : atRisk, out0)
    foldValues(set1, set0, reach0, folder === 1 ? -atRisk : atRisk, out1)
  }

  // Chance sampling, with the correction that card removal demands.
  //
  // The exact counterfactual value sums over the cards neither holding uses,
  // weighted 1/(n-4): of the n cards off the board, four are spoken for by the
  // two hands. What is cheap to sample is a card uniform over all n, with the
  // holdings it blocks dropped. Those two differ by exactly n/(n-4), so the
  // scale goes on here.
  //
  // It is not a cosmetic constant. Leave it out and every line that sees
  // another street is undervalued against one that ends in an immediate fold -
  // 9% on the flop, compounding with 9% again on the turn.
  //
  // The holdings the card blocks are marked dead as well as zeroed. Zeroing
  // their reach stops them reaching terminals, but it does not stop the
  // traversal computing a value for them on the way back and folding it into
  // their regrets at every decision node below here - and that value would be
  // scored off a CONFLICT rank, i.e. as though the holding were the worst hand
  // possible. A deal that cannot happen must leave no trace, not a pessimistic
  // one.
  private chance(
    node: number,
    reach0: Float64Array,
    reach1: Float64Array,
    out0: Float64Array,
    out1: Float64Array
  ): void {
    const dealt = this.tree.street[node] - this.rootStreet
    const card = this.runoutCards[dealt]
    const available = 52 - this.rootBoardLength - dealt
    const scale = available / (available - 4)

    const n0 = this.hands[0].count
    const n1 = this.hands[1].count
    const blocked0 = this.hands[0].byCard[card]
    const blocked1 = this.hands[1].byCard[card]

    const mark = this.arena.mark()
    // Copies: the caller's reach vectors are shared with sibling subtrees.
    const next0 = this.arena.alloc(n0)
    const next1 = this.arena.alloc(n1)
    next0.set(reach0)
    next1.set(reach1)

    const depth0 = this.deadList[0].length
    const depth1 = this.deadList[1].length
    this.kill(0, blocked0, next0)
    this.kill(1, blocked1, next1)

    this.walk(this.tree.chanceChild[node], next0, next1, out0, out1)

    // Everything dead by this point, not just what this card killed - the
    // child may be a terminal, which knows nothing about any of it.
    for (const h of this.deadList[0]) out0[h] = 0
    for (const g of this.deadList[1]) out1[g] = 0

    for (let h = 0; h < n0; h++) out0[h] *= scale
    for (let g = 0; g < n1; g++) out1[g] *= scale

    this.revive(0, depth0)
    this.revive(1, depth1)
    this.arena.release(mark)
  }

  private kill(player: number, hands: Int32Array, reach: Float64Array): void {
    const dead = this.dead[player]
    const list = this.deadList[player]
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i]
      reach[h] = 0
      if (dead[h] === 0) {
        dead[h] = 1
        list.push(h)
      }
    }
  }

  private revive(player: number, depth: number): void {
    const dead = this.dead[player]
    const list = this.deadList[player]
    while (list.length > depth) dead[list.pop() as number] = 0
  }

  private decision(
    node: number,
    player: number,
    reach0: Float64Array,
    reach1: Float64Array,
    out0: Float64Array,
    out1: Float64Array
  ): void {
    const tree = this.tree
    const opponent = 1 - player
    const reachP = player === 0 ? reach0 : reach1
    const outP = player === 0 ? out0 : out1
    const outOpp = player === 0 ? out1 : out0

    const nHands = this.hands[player].count
    const nOpp = this.hands[opponent].count
    const actions = tree.actionCount[node]
    const start = tree.actionStart[node]
    const base = this.slotStart[node]
    const regret = this.regret

    const mark = this.arena.mark()
    const strategy = this.arena.alloc(nHands * actions)

    // Regret matching, per hand.
    for (let h = 0; h < nHands; h++) {
      const o = h * actions
      let sum = 0
      for (let a = 0; a < actions; a++) {
        const r = regret[base + o + a]
        const positive = r > 0 ? r : 0
        strategy[o + a] = positive
        sum += positive
      }
      if (sum > 0) {
        const inv = 1 / sum
        for (let a = 0; a < actions; a++) strategy[o + a] *= inv
      } else {
        const uniform = 1 / actions
        for (let a = 0; a < actions; a++) strategy[o + a] = uniform
      }
    }

    if (this.updating) {
      const weight = this.strategyWeight
      const sums = this.strategySum
      for (let h = 0; h < nHands; h++) {
        const reach = reachP[h]
        if (reach === 0) continue
        const o = h * actions
        const w = weight * reach
        for (let a = 0; a < actions; a++) sums[base + o + a] += w * strategy[o + a]
      }
    }

    const actionValues = this.arena.alloc(actions * nHands)
    const childOpp = this.arena.alloc(nOpp)
    const reachA = this.arena.alloc(nHands)
    outOpp.fill(0)

    for (let a = 0; a < actions; a++) {
      for (let h = 0; h < nHands; h++) reachA[h] = reachP[h] * strategy[h * actions + a]
      const values = actionValues.subarray(a * nHands, (a + 1) * nHands)
      const child = tree.children[start + a]
      if (player === 0) this.walk(child, reachA, reach1, values, childOpp)
      else this.walk(child, reach0, reachA, childOpp, values)
      // The opponent's counterfactual value already carries this player's
      // strategy, through the reach it was recursed with, so these just add.
      for (let g = 0; g < nOpp; g++) outOpp[g] += childOpp[g]
    }

    for (let h = 0; h < nHands; h++) {
      const o = h * actions
      let value = 0
      for (let a = 0; a < actions; a++) value += strategy[o + a] * actionValues[a * nHands + h]
      outP[h] = value
    }

    // A holding a runout card has already blocked is not in play here, so it
    // reports nothing upstream and learns nothing from what it was scored
    // against - see `chance`.
    const dead = this.dead[player]
    for (const h of this.deadList[player]) outP[h] = 0
    for (const g of this.deadList[opponent]) outOpp[g] = 0

    if (this.updating) {
      // Dead holdings skip the linear discount along with the update. That
      // leaves their regrets weighted a little differently from a live
      // holding's, but identically across their own actions, which is all
      // regret matching reads.
      const discount = this.discount
      for (let h = 0; h < nHands; h++) {
        if (dead[h] === 1) continue
        const o = h * actions
        const value = outP[h]
        for (let a = 0; a < actions; a++) {
          regret[base + o + a] =
            regret[base + o + a] * discount + (actionValues[a * nHands + h] - value)
        }
      }
    }

    this.arena.release(mark)
  }

  // --- reading the result ---

  // The node reached by taking these actions from the root, walking through any
  // chance node on the way.
  nodeFor(line: string[]): number {
    let node = 0
    for (const action of line) {
      while (this.tree.player[node] === CHANCE) node = this.tree.chanceChild[node]
      if (this.tree.player[node] === TERMINAL) {
        throw new Error(`[${line}] runs past a terminal`)
      }
      const start = this.tree.actionStart[node]
      const count = this.tree.actionCount[node]
      const offset = this.tree.actions.slice(start, start + count).indexOf(action)
      if (offset < 0) throw new Error(`no action "${action}" at node ${node}`)
      node = this.tree.children[start + offset]
    }
    return node
  }

  actionsAt(node: number): string[] {
    const start = this.tree.actionStart[node]
    return this.tree.actions.slice(start, start + this.tree.actionCount[node])
  }

  // The raw accumulated regrets for one holding. Regret matching throws away
  // everything negative, so two very different regret vectors can produce the
  // same strategy - which makes this the only way to see whether something has
  // been written that should not have been.
  regretsAt(node: number, hand: number): Float64Array {
    const player = this.tree.player[node]
    if (player === CHANCE || player === TERMINAL) throw new Error(`node ${node} does not act`)
    const actions = this.tree.actionCount[node]
    const base = this.slotStart[node] + hand * actions
    return Float64Array.from(this.regret.subarray(base, base + actions))
  }

  // The regret-matched strategy one holding is playing right now. This is what
  // the traversal itself uses; the average is what the solve converges to.
  currentStrategy(node: number, hand: number): Float64Array {
    const player = this.tree.player[node]
    if (player === CHANCE || player === TERMINAL) throw new Error(`node ${node} does not act`)
    const actions = this.tree.actionCount[node]
    const base = this.slotStart[node] + hand * actions

    const out = new Float64Array(actions)
    let sum = 0
    for (let a = 0; a < actions; a++) {
      const r = this.regret[base + a]
      const positive = r > 0 ? r : 0
      out[a] = positive
      sum += positive
    }
    if (sum > 0) {
      for (let a = 0; a < actions; a++) out[a] /= sum
    } else {
      out.fill(1 / actions)
    }
    return out
  }

  // The average strategy for one holding: what CFR actually converges to, as
  // opposed to the current regret-matched strategy, which keeps moving.
  averageStrategy(node: number, hand: number): Float64Array {
    const player = this.tree.player[node]
    if (player === CHANCE || player === TERMINAL) throw new Error(`node ${node} does not act`)
    const actions = this.tree.actionCount[node]
    const base = this.slotStart[node] + hand * actions

    const out = new Float64Array(actions)
    let total = 0
    for (let a = 0; a < actions; a++) total += this.strategySum[base + a]
    for (let a = 0; a < actions; a++) {
      out[a] = total > 0 ? this.strategySum[base + a] / total : 1 / actions
    }
    return out
  }

  // Every holding whose combo class is in `classes` ('KK', 'AQo').
  handsInClasses(player: number, classes: string[]): number[] {
    const wanted = new Set(classes)
    const out: number[] = []
    this.hands[player].cards.forEach((cards, i) => {
      if (wanted.has(comboClass(cards))) out.push(i)
    })
    return out
  }

  // One action distribution for a set of holdings, weighted by their share of
  // the range - the same aggregation CFRSolver.getRangeStrategy does, so the
  // two solvers can be compared directly.
  aggregateStrategy(node: number, classes?: string[]): Map<string, number> {
    const player = this.tree.player[node]
    if (player === CHANCE || player === TERMINAL) throw new Error(`node ${node} does not act`)
    const names = this.actionsAt(node)
    const hands =
      classes === undefined
        ? Array.from({ length: this.hands[player].count }, (_, i) => i)
        : this.handsInClasses(player, classes)

    const totals = new Float64Array(names.length)
    let totalWeight = 0
    for (const h of hands) {
      const weight = this.hands[player].weight[h]
      const strategy = this.averageStrategy(node, h)
      for (let a = 0; a < names.length; a++) totals[a] += weight * strategy[a]
      totalWeight += weight
    }

    const out = new Map<string, number>()
    names.forEach((name, a) => out.set(name, totalWeight > 0 ? totals[a] / totalWeight : 0))
    return out
  }

  // Rough in-memory size of everything the solve holds on to.
  bytes(): number {
    return (
      this.regret.byteLength +
      this.strategySum.byteLength +
      this.arena.capacity * 8 +
      this.table.ranks.byteLength
    )
  }

  get slotCount(): number {
    return this.regret.length
  }

  // Info sets, in the sense the sampled solver counts them: one per decision
  // the solver has to answer separately. Here that is (public tree node,
  // holding) - every one of which is updated on every iteration, which is the
  // whole point. The sampled solver's count is not comparable, since it keys
  // on a strength bucket and only creates an info set when sampling reaches it.
  get infoSetCount(): number {
    let total = 0
    for (let n = 0; n < this.tree.nodeCount; n++) {
      const p = this.tree.player[n]
      if (p === CHANCE || p === TERMINAL) continue
      total += this.hands[p].count
    }
    return total
  }
}
