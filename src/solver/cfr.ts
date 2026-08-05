import { GameNode, applyAction } from './game-tree'
import { InfoSet, InfoSetManager } from './infoset'
import { Card } from '../engine/cards'
import { evaluateHand } from '../engine/evaluator'

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

  private getInfoSetKey(node: GameNode, hand: Card[]): string {
    const handStr = hand.map(c => `${c.rank}${c.suit}`).join(',')
    return `${handStr}|${node.history}`
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

      const pot = node.pot
      if (value0 > value1) {
        return [pot / 2, -pot / 2]
      } else if (value1 > value0) {
        return [-pot / 2, pot / 2]
      } else {
        return [0, 0]
      }
    }

    const player = node.player
    const infoSetKey = this.getInfoSetKey(node, hands[player])
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

  solve(
    rootNode: GameNode,
    hands: [Card[], Card[]],
    iterations: number = 1000
  ): CFRResult {
    for (let i = 0; i < iterations; i++) {
      this.cfr(rootNode, hands, [1, 1])
      this.iterations++
    }

    return {
      infoSets: this.infoSetManager.getAllInfoSets(),
      iterations: this.iterations,
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
    this.iterations = 0
  }
}
