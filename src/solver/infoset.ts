export class InfoSet {
  public regretSum: Map<string, number> = new Map()
  public strategySum: Map<string, number> = new Map()
  public actions: string[]

  constructor(public key: string, actions: string[]) {
    this.actions = actions
    actions.forEach(action => {
      this.regretSum.set(action, 0)
      this.strategySum.set(action, 0)
    })
  }

  // Regret matching. Pure - accumulating toward the average strategy is a
  // separate step because external sampling does the two at different nodes.
  currentStrategy(): Map<string, number> {
    const strategy = new Map<string, number>()
    let normalizingSum = 0

    this.actions.forEach(action => {
      const regret = Math.max(0, this.regretSum.get(action) || 0)
      strategy.set(action, regret)
      normalizingSum += regret
    })

    this.actions.forEach(action => {
      if (normalizingSum > 0) {
        strategy.set(action, (strategy.get(action) || 0) / normalizingSum)
      } else {
        strategy.set(action, 1 / this.actions.length)
      }
    })

    return strategy
  }

  accumulateStrategy(strategy: Map<string, number>, weight: number = 1): void {
    strategy.forEach((prob, action) => {
      this.strategySum.set(action, (this.strategySum.get(action) || 0) + weight * prob)
    })
  }

  getAverageStrategy(): Map<string, number> {
    const avgStrategy = new Map<string, number>()
    let normalizingSum = 0

    this.actions.forEach(action => {
      normalizingSum += this.strategySum.get(action) || 0
    })

    this.actions.forEach(action => {
      if (normalizingSum > 0) {
        avgStrategy.set(action, (this.strategySum.get(action) || 0) / normalizingSum)
      } else {
        avgStrategy.set(action, 1 / this.actions.length)
      }
    })

    return avgStrategy
  }

  addRegret(action: string, regret: number): void {
    this.regretSum.set(action, (this.regretSum.get(action) || 0) + regret)
  }
}

export class InfoSetManager {
  private infoSets: Map<string, InfoSet> = new Map()

  getInfoSet(key: string, actions: string[]): InfoSet {
    if (!this.infoSets.has(key)) {
      this.infoSets.set(key, new InfoSet(key, actions))
    }
    return this.infoSets.get(key)!
  }

  // Look up without creating one when it's missing.
  find(key: string): InfoSet | undefined {
    return this.infoSets.get(key)
  }

  getAllInfoSets(): InfoSet[] {
    return Array.from(this.infoSets.values())
  }

  clear(): void {
    this.infoSets.clear()
  }
}
