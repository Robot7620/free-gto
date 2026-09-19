// Terminal values at a showdown or a fold, computed across a whole range at
// once.
//
// This is the subtlest arithmetic in the solver. For each of hero's holdings we
// need the reach-weighted sum over villain's holdings, counting only those that
// don't share a card - two players cannot hold the same card, and ignoring that
// biases every downstream number in a way that still looks plausible. The naive
// form is an obvious double loop; the fast form gets the same answer in one
// pass and is what the solver actually calls. `showdownValuesNaive` exists so
// the fast one has something to be wrong against.

export interface HandSet {
  count: number
  // Card numbers 0-51 for the two hole cards.
  cardA: Int32Array
  cardB: Int32Array
  // Showdown strength on the current board. Higher wins.
  rank: Int32Array
}

export function makeHandSet(hands: [number, number][], ranks: number[]): HandSet {
  return {
    count: hands.length,
    cardA: Int32Array.from(hands.map(h => h[0])),
    cardB: Int32Array.from(hands.map(h => h[1])),
    rank: Int32Array.from(ranks),
  }
}

const DECK = 52

function pairKey(a: number, b: number): number {
  return a < b ? a * DECK + b : b * DECK + a
}

// Reference implementation: for every hero hand, walk every villain hand.
// Quadratic and never used in the hot loop - it's the thing the fast path is
// checked against.
export function showdownValuesNaive(
  hero: HandSet,
  villain: HandSet,
  villainReach: Float64Array,
  atRisk: number,
  out: Float64Array
): void {
  for (let h = 0; h < hero.count; h++) {
    const a = hero.cardA[h]
    const b = hero.cardB[h]
    const rank = hero.rank[h]
    let total = 0

    for (let g = 0; g < villain.count; g++) {
      const ga = villain.cardA[g]
      const gb = villain.cardB[g]
      if (ga === a || ga === b || gb === a || gb === b) continue

      const r = villainReach[g]
      if (rank > villain.rank[g]) total += r
      else if (rank < villain.rank[g]) total -= r
    }

    out[h] = atRisk * total
  }
}

export function foldValuesNaive(
  hero: HandSet,
  villain: HandSet,
  villainReach: Float64Array,
  amount: number,
  out: Float64Array
): void {
  for (let h = 0; h < hero.count; h++) {
    const a = hero.cardA[h]
    const b = hero.cardB[h]
    let total = 0

    for (let g = 0; g < villain.count; g++) {
      const ga = villain.cardA[g]
      const gb = villain.cardB[g]
      if (ga === a || ga === b || gb === a || gb === b) continue
      total += villainReach[g]
    }

    out[h] = amount * total
  }
}

// Hand indices in increasing rank order.
//
// Exported because the order depends only on the ranks, and the ranks change
// once per runout while showdownValues is called at every showdown terminal in
// the tree - a few thousand times per iteration on a flop. Sorting there was
// most of the solver's running time. A caller that already holds the order can
// pass it in, PROVIDED it was computed from the ranks currently in the set;
// hand back a stale one and the sweep will quietly return wrong numbers.
export function rankOrder(set: HandSet): Int32Array {
  const order = Array.from({ length: set.count }, (_, i) => i)
  order.sort((x, y) => set.rank[x] - set.rank[y])
  return Int32Array.from(order)
}

// One sweep instead of hero.count * villain.count.
//
// Walking both ranges in rank order gives, for each hero hand, the reach of
// every villain hand strictly worse (`won`) and strictly better (`lost`). Card
// blocking is then removed by tracking the same sums per card and subtracting
// the two cards hero holds.
//
// No inclusion-exclusion term is needed here, and the reason is worth stating.
// A villain hand using BOTH of hero's cards is the same two cards scored on the
// same board, so it necessarily has hero's exact rank. It lands in the tie
// group, contributes nothing to `won` or `lost`, and there is therefore nothing
// for the two per-card subtractions to double-count. The fold path below is
// different: its value doesn't depend on rank, so that hand carries real weight
// there and genuinely has to be added back.
//
// PRECONDITION: rank is a function of the cards - the same holding scored on
// the same board gets the same rank in both sets. That holds by construction,
// since both look the value up from the same showdown table.
export function showdownValues(
  hero: HandSet,
  villain: HandSet,
  villainReach: Float64Array,
  atRisk: number,
  out: Float64Array,
  heroOrder: Int32Array = rankOrder(hero),
  villainOrder: Int32Array = rankOrder(villain)
): void {
  const totalCard = new Float64Array(DECK)
  const wonCard = new Float64Array(DECK)
  const tieCard = new Float64Array(DECK)

  let total = 0
  for (let g = 0; g < villain.count; g++) {
    const r = villainReach[g]
    total += r
    totalCard[villain.cardA[g]] += r
    totalCard[villain.cardB[g]] += r
  }

  let won = 0
  let j = 0
  let i = 0

  while (i < hero.count) {
    const rank = hero.rank[heroOrder[i]]

    // Everything strictly worse than this rank is settled as a win.
    while (j < villain.count && villain.rank[villainOrder[j]] < rank) {
      const g = villainOrder[j]
      const r = villainReach[g]
      won += r
      wonCard[villain.cardA[g]] += r
      wonCard[villain.cardB[g]] += r
      j++
    }

    // Villain hands sharing this exact rank chop, so they belong to neither
    // side. Collect them separately; they become wins once hero's rank rises
    // past them on a later pass.
    let tie = 0
    let k = j
    while (k < villain.count && villain.rank[villainOrder[k]] === rank) {
      const g = villainOrder[k]
      const r = villainReach[g]
      tie += r
      tieCard[villain.cardA[g]] += r
      tieCard[villain.cardB[g]] += r
      k++
    }

    const lost = total - won - tie

    while (i < hero.count && hero.rank[heroOrder[i]] === rank) {
      const h = heroOrder[i]
      const a = hero.cardA[h]
      const b = hero.cardB[h]

      const wonVisible = won - wonCard[a] - wonCard[b]
      const lostVisible =
        lost -
        (totalCard[a] - wonCard[a] - tieCard[a]) -
        (totalCard[b] - wonCard[b] - tieCard[b])

      out[h] = atRisk * (wonVisible - lostVisible)
      i++
    }

    // Clear only the cards this rank group touched, so the reset stays
    // proportional to the group rather than the deck.
    for (let t = j; t < k; t++) {
      const g = villainOrder[t]
      tieCard[villain.cardA[g]] = 0
      tieCard[villain.cardB[g]] = 0
    }
  }
}

// A fold pays the same regardless of hero's strength, so this is just the
// blocked-aware reach total. Unlike the showdown case, hero's own holding is
// double-counted across the two per-card sums and has to be added back once -
// nothing about a fold makes its contribution cancel.
export function foldValues(
  hero: HandSet,
  villain: HandSet,
  villainReach: Float64Array,
  amount: number,
  out: Float64Array
): void {
  let total = 0
  const totalCard = new Float64Array(DECK)
  for (let g = 0; g < villain.count; g++) {
    const r = villainReach[g]
    total += r
    totalCard[villain.cardA[g]] += r
    totalCard[villain.cardB[g]] += r
  }

  const pairReach = new Map<number, number>()
  for (let g = 0; g < villain.count; g++) {
    pairReach.set(pairKey(villain.cardA[g], villain.cardB[g]), villainReach[g])
  }

  for (let h = 0; h < hero.count; h++) {
    const a = hero.cardA[h]
    const b = hero.cardB[h]
    const both = pairReach.get(pairKey(a, b)) ?? 0
    out[h] = amount * (total - totalCard[a] - totalCard[b] + both)
  }
}
