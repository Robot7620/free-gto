import { GameNode, applyAction } from './game-tree'
import { InfoSet, InfoSetManager } from './infoset'
import { Card, cardToNumber } from '../engine/cards'
import { evaluateHand } from '../engine/evaluator'
import { Range } from '../engine/range'
import { enumerateRangeCombos, sampleCombo, conflictsWith } from '../engine/combos'

export interface CFRResult {
  infoSets: InfoSet[]
  iterations: number
  exploitability?: number
}

export class CFRSolver {
  private infoSetManager: InfoSetManager
  private iterations: number = 0

  constructor() {
    this.infoSetManager = new InfoSetManager()
  }

  private getInfoSetKey(history: string, hand: Card[]): string {
    // Sort so the same holding always maps to one info set regardless of the
    // order the two cards happen to be in.
    const handStr = [...hand]
      .sort((a, b) => cardToNumber(b) - cardToNumber(a))
      .map(c => `${c.rank}:${c.suit}`)
      .join(',')
    return `${handStr}|${history}`
  }

  private cfr(
    node: GameNode,
    hands: [Card[], Card[]],
    reach: [number, number]
  ): number[] {
    const numPlayers = 2

    if (node.isTerminal) {
      if (node.payoff) {
        return node.payoff
      }

      const fullHand0 = [...hands[0], ...node.board]
      const fullHand1 = [...hands[1], ...node.board]

      const value0 = evaluateHand(fullHand0).value
      const value1 = evaluateHand(fullHand1).value

      // The winner takes what the loser matched; anything either player put in
      // beyond that comes back to them, so a tie nets zero.
      const atRisk = Math.min(node.contributed[0], node.contributed[1])
      if (value0 > value1) {
        return [atRisk, -atRisk]
      } else if (value1 > value0) {
        return [-atRisk, atRisk]
      } else {
        return [0, 0]
      }
    }

    const player = node.player
    const infoSetKey = this.getInfoSetKey(node.history, hands[player])
    const infoSet = this.infoSetManager.getInfoSet(infoSetKey, node.actions)

    const strategy = infoSet.getStrategy(reach[player])

    const actionUtils: Map<string, number[]> = new Map()
    const nodeUtil: number[] = [0, 0]

    node.actions.forEach(action => {
      const newNode = applyAction(node, action)
      const actionProb = strategy.get(action) || 0

      const newReach: [number, number] = [...reach]
      newReach[player] *= actionProb

      const util = this.cfr(newNode, hands, newReach)
      actionUtils.set(action, util)

      for (let p = 0; p < numPlayers; p++) {
        nodeUtil[p] += actionProb * util[p]
      }
    })

    node.actions.forEach(action => {
      const util = actionUtils.get(action)!
      const regret = util[player] - nodeUtil[player]
      infoSet.addRegret(action, reach[1 - player] * regret)
    })

    return nodeUtil
  }

  // Chance-sampled CFR: each iteration deals one holding to each player from
  // their range (proportional to combo weight, excluding cards already on the
  // board or held by the opponent), then runs vanilla CFR on that deal. Over
  // many iterations this converges to the range-vs-range equilibrium.
  solve(
    rootNode: GameNode,
    ranges: [Range, Range],
    board: Card[],
    iterations: number = 1000
  ): CFRResult {
    const combos0 = enumerateRangeCombos(ranges[0], board)
    const combos1 = enumerateRangeCombos(ranges[1], board)

    for (let i = 0; i < iterations; i++) {
      const hand0 = sampleCombo(combos0)
      if (!hand0) break

      const available1 = combos1.filter(c => !conflictsWith(c.cards, hand0.cards))
      const hand1 = sampleCombo(available1)
      if (!hand1) continue

      this.cfr(rootNode, [hand0.cards, hand1.cards], [1, 1])
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
      const infoSet = this.infoSetManager.find(this.getInfoSetKey(history, cards))
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
    this.iterations = 0
  }
}
