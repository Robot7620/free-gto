import { HAND_COMBOS, getComboCount } from '../utils/poker'

export class Range {
  private weights: Map<string, number>

  constructor(weights: Map<string, number> = new Map()) {
    this.weights = new Map(weights)
  }

  static empty(): Range {
    return new Range()
  }

  static full(): Range {
    const weights = new Map<string, number>()
    HAND_COMBOS.forEach(combo => weights.set(combo, 1.0))
    return new Range(weights)
  }

  static fromString(rangeStr: string): Range {
    const range = Range.empty()
    const combos = rangeStr.split(',').map(s => s.trim())

    combos.forEach(combo => {
      if (HAND_COMBOS.includes(combo)) {
        range.setWeight(combo, 1.0)
      } else {
        const match = combo.match(/^(.+):(\d+\.?\d*)$/)
        if (match) {
          const [, hand, weight] = match
          if (HAND_COMBOS.includes(hand)) {
            range.setWeight(hand, parseFloat(weight))
          }
        }
      }
    })

    return range
  }

  setWeight(combo: string, weight: number): void {
    if (weight < 0 || weight > 1) {
      throw new Error('Weight must be between 0 and 1')
    }
    if (weight === 0) {
      this.weights.delete(combo)
    } else {
      this.weights.set(combo, weight)
    }
  }

  getWeight(combo: string): number {
    return this.weights.get(combo) || 0
  }

  contains(combo: string): boolean {
    return this.weights.has(combo)
  }

  getCombos(): string[] {
    return Array.from(this.weights.keys())
  }

  getWeightedCombos(): { combo: string; weight: number }[] {
    return Array.from(this.weights.entries()).map(([combo, weight]) => ({
      combo,
      weight,
    }))
  }

  getTotalCombos(): number {
    let total = 0
    this.weights.forEach((weight, combo) => {
      total += getComboCount(combo) * weight
    })
    return total
  }

  union(other: Range): Range {
    const result = new Range(this.weights)
    other.weights.forEach((weight, combo) => {
      const currentWeight = result.getWeight(combo)
      result.setWeight(combo, Math.max(currentWeight, weight))
    })
    return result
  }

  intersect(other: Range): Range {
    const result = Range.empty()
    this.weights.forEach((weight, combo) => {
      const otherWeight = other.getWeight(combo)
      if (otherWeight > 0) {
        result.setWeight(combo, Math.min(weight, otherWeight))
      }
    })
    return result
  }

  remove(other: Range): Range {
    const result = new Range(this.weights)
    other.weights.forEach((_, combo) => {
      result.setWeight(combo, 0)
    })
    return result
  }

  scale(factor: number): Range {
    const result = Range.empty()
    this.weights.forEach((weight, combo) => {
      result.setWeight(combo, Math.min(1, weight * factor))
    })
    return result
  }

  clone(): Range {
    return new Range(this.weights)
  }

  toString(): string {
    return this.getWeightedCombos()
      .map(({ combo, weight }) => weight === 1 ? combo : `${combo}:${weight.toFixed(2)}`)
      .join(', ')
  }

  isEmpty(): boolean {
    return this.weights.size === 0
  }

  size(): number {
    return this.weights.size
  }
}
