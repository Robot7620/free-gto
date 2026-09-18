import { GameNode, applyAction, advanceStreet } from './game-tree'
import { InfoSet, InfoSetManager } from './infoset'
import { Card, cardToNumber, createDeck, removeCards } from '../engine/cards'
import { evaluateHand } from '../engine/evaluator'
import { Range } from '../engine/range'
import { enumerateRangeCombos, sampleCombo, conflictsWith } from '../engine/combos'
import { Rng, defaultRng, makeRng } from './rng'

export interface CFRResult {
  infoSets: InfoSet[]
  iterations: number
  exploitability?: number
}

export interface CoverageStats {
  infoSets: number
  medianVisits: number
  p10Visits: number
  fractionUnderThreshold: number
  threshold: number
}

// Measured reference points, 20k iterations on Ks9h4c(+2d,7s), 100bb/10bb:
//
//   street  infosets  mean  p10  median  p90  under-30
//   river      2,571  23.0    2       9   41       84%   <- produces good output
//   turn     104,934   4.4    0       1   10       98%
//   flop     623,925   2.4    0       1    5       99%   <- produces noise
//
// Note the distribution is heavily skewed, so judge by median, not mean. Even
// the river solve - the one that works - leaves 84% of its info sets under 30
// visits; it's fine because the lines that actually get reached are the ones
// that get sampled. Median 9 works, median 1 does not.

// Strip the dealt runout cards out of a history, leaving just the betting line
// (streets still separated by '|'). Which card came is already reflected in the
// player's strength bucket, so keeping it in the key too would split one
// decision into 45 near-identical ones.
export function bettingLine(history: string): string {
  return history
    .split('|')
    .map(segment => (segment.includes(':') ? segment.slice(segment.indexOf(':') + 1) : segment))
    .join('|')
}

function sampleAction(strategy: Map<string, number>, actions: string[], rng: Rng): string {
  let target = rng()
  for (const action of actions) {
    target -= strategy.get(action) || 0
    if (target <= 0) return action
  }
  return actions[actions.length - 1]
}

export class CFRSolver {
  private infoSetManager: InfoSetManager
  private iterations: number = 0
  private bucketCache: Map<string, number> = new Map()
  private rng: Rng

  constructor(seed?: number) {
    this.infoSetManager = new InfoSetManager()
    this.rng = seed === undefined ? defaultRng : makeRng(seed)
  }

  // Hand strength on the current board, bucketed. The evaluator packs the hand
  // category into the high bits and the primary rank just below, so shifting
  // off the kickers leaves "category + top rank" - enough to keep top pair and
  // bottom pair apart without tracking every holding separately.
  private handBucket(hand: Card[], board: Card[]): number {
    const key =
      hand.map(cardToNumber).sort((a, b) => a - b).join(',') +
      '/' +
      board.map(cardToNumber).join(',')

    const cached = this.bucketCache.get(key)
    if (cached !== undefined) return cached

    const bucket = evaluateHand([...hand, ...board]).value >>> 16
    this.bucketCache.set(key, bucket)
    return bucket
  }

  private getInfoSetKey(history: string, hand: Card[], board: Card[]): string {
    return `${this.handBucket(hand, board)}|${bettingLine(history)}`
  }

  // Value of a finished hand from `traverser`'s point of view.
  private terminalUtility(
    node: GameNode,
    hands: [Card[], Card[]],
    traverser: number
  ): number {
    if (node.payoff) {
      return node.payoff[traverser]
    }

    const value0 = evaluateHand([...hands[0], ...node.board]).value
    const value1 = evaluateHand([...hands[1], ...node.board]).value

    // The winner takes what the loser matched; anything either player put in
    // beyond that comes back to them, so a tie nets zero.
    const atRisk = Math.min(node.contributed[0], node.contributed[1])
    if (value0 === value1) return 0

    const winner = value0 > value1 ? 0 : 1
    return traverser === winner ? atRisk : -atRisk
  }

  private sampleRunout(node: GameNode, deck: Card[]): Card | null {
    // `deck` excludes the root board and both holdings; only cards dealt on
    // later streets still need filtering out.
    const dealt = new Set(node.board.map(cardToNumber))
    const available = deck.filter(c => !dealt.has(cardToNumber(c)))
    if (available.length === 0) return null
    return available[Math.floor(this.rng() * available.length)]
  }

  // External-sampling MCCFR. Only the traverser's own decision nodes branch
  // across every action; the opponent's nodes and chance nodes each sample a
  // single outcome. Full traversal is hopeless once the tree spans three
  // streets - the runouts alone multiply it out of reach.
  private traverse(
    node: GameNode,
    hands: [Card[], Card[]],
    traverser: number,
    deck: Card[]
  ): number {
    if (node.isTerminal) {
      return this.terminalUtility(node, hands, traverser)
    }

    if (node.isChance) {
      const card = this.sampleRunout(node, deck)
      if (!card) return this.terminalUtility(node, hands, traverser)
      return this.traverse(advanceStreet(node, card), hands, traverser, deck)
    }

    const player = node.player
    const infoSetKey = this.getInfoSetKey(node.history, hands[player], node.board)
    const infoSet = this.infoSetManager.getInfoSet(infoSetKey, node.actions)
    const strategy = infoSet.currentStrategy()

    if (player !== traverser) {
      // Opponent node: accumulate their average strategy and follow one action.
      infoSet.accumulateStrategy(strategy)
      const action = sampleAction(strategy, node.actions, this.rng)
      return this.traverse(applyAction(node, action), hands, traverser, deck)
    }

    const utils = new Map<string, number>()
    let nodeUtil = 0

    node.actions.forEach(action => {
      const util = this.traverse(applyAction(node, action), hands, traverser, deck)
      utils.set(action, util)
      nodeUtil += (strategy.get(action) || 0) * util
    })

    // Under external sampling the opponent's reach is already accounted for by
    // the sampling, so regrets take no extra weighting.
    node.actions.forEach(action => {
      infoSet.addRegret(action, (utils.get(action) || 0) - nodeUtil)
    })
    infoSet.visits++

    return nodeUtil
  }

  // Each iteration deals a holding to each player from their range
  // (proportional to combo weight, excluding cards on the board or held by the
  // opponent), then runs one external-sampling traversal. The traverser
  // alternates so both players' strategies improve. Over many iterations this
  // converges to the range-vs-range equilibrium.
  solve(
    rootNode: GameNode,
    ranges: [Range, Range],
    board: Card[],
    iterations: number = 1000
  ): CFRResult {
    const combos0 = enumerateRangeCombos(ranges[0], board)
    const combos1 = enumerateRangeCombos(ranges[1], board)
    const fullDeck = createDeck()

    for (let i = 0; i < iterations; i++) {
      const hand0 = sampleCombo(combos0, this.rng)
      if (!hand0) break

      const available1 = combos1.filter(c => !conflictsWith(c.cards, hand0.cards))
      const hand1 = sampleCombo(available1, this.rng)
      if (!hand1) continue

      const hands: [Card[], Card[]] = [hand0.cards, hand1.cards]
      const deck = removeCards(fullDeck, [...board, ...hands[0], ...hands[1]])

      this.traverse(rootNode, hands, this.iterations % 2, deck)
      this.iterations++
    }

    return {
      infoSets: this.infoSetManager.getAllInfoSets(),
      iterations: this.iterations,
    }
  }

  // Combine every holding's strategy at a node into one range-wide action
  // distribution, weighted by each holding's share of the range.
  getRangeStrategy(
    range: Range,
    board: Card[],
    history: string = ''
  ): Map<string, number> {
    const totals = new Map<string, number>()
    let totalWeight = 0

    enumerateRangeCombos(range, board).forEach(({ cards, weight }) => {
      const infoSet = this.infoSetManager.find(this.getInfoSetKey(history, cards, board))
      if (!infoSet) return

      infoSet.getAverageStrategy().forEach((prob, action) => {
        totals.set(action, (totals.get(action) || 0) + prob * weight)
      })
      totalWeight += weight
    })

    if (totalWeight > 0) {
      totals.forEach((value, action) => totals.set(action, value / totalWeight))
    }

    return totals
  }

  // How well sampled the solve actually is. Report this before reporting any
  // strategy - an under-covered solve returns confident-looking numbers that
  // are still essentially the uniform strategy it started from.
  getCoverageStats(threshold: number = 30): CoverageStats {
    const visits = this.infoSetManager
      .getAllInfoSets()
      .map(is => is.visits)
      .sort((a, b) => a - b)

    if (visits.length === 0) {
      return { infoSets: 0, medianVisits: 0, p10Visits: 0, fractionUnderThreshold: 0, threshold }
    }

    const at = (q: number) => visits[Math.min(visits.length - 1, Math.floor(visits.length * q))]
    const under = visits.filter(v => v < threshold).length

    return {
      infoSets: visits.length,
      medianVisits: at(0.5),
      p10Visits: at(0.1),
      fractionUnderThreshold: under / visits.length,
      threshold,
    }
  }

  getStrategy(infoSetKey: string): Map<string, number> | null {
    const infoSets = this.infoSetManager.getAllInfoSets()
    const infoSet = infoSets.find(is => is.key === infoSetKey)
    return infoSet ? infoSet.getAverageStrategy() : null
  }

  getAllStrategies(): Map<string, Map<string, number>> {
    const strategies = new Map<string, Map<string, number>>()
    this.infoSetManager.getAllInfoSets().forEach(infoSet => {
      strategies.set(infoSet.key, infoSet.getAverageStrategy())
    })
    return strategies
  }

  reset(): void {
    this.infoSetManager.clear()
    this.bucketCache.clear()
    this.iterations = 0
  }
}
