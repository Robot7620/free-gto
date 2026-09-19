# TODO

## Current state (2026-09-19)

Working through a plan to fix flop convergence by switching to **vectorized
exact-hand CFR** — the architecture real solvers use: abstract the betting tree,
keep hole cards exact. Full plan at
`~/.claude/plans/let-s-go-ahead-and-cryptic-horizon.md`.

**Phase 1 done** (`6842f6b`): vitest, the invariant suite brought into the repo,
a seeded RNG, per-info-set visit counts, and a river ground-truth fixture.
14 tests passing.

**Phase 2 done**: bet sizings and the raise cap are now a `TreeConfig` carried on
the node (`DEFAULT_TREE_CONFIG` = 50/pot/all-in, `RICH_TREE_CONFIG` = the old
five-size tree, kept for comparison), and `advanceStreet` collapses the forced
check/check runout once both stacks are empty.

Measured on Ks9h4c, 100bb/10bb, seed 12345:

| config | time | info sets | median visits | KK | 99 | AQo | 55 |
|---|---|---|---|---|---|---|---|
| rich 5-size,  20k | 13.1s | 534,651 | 1 | 73% | 50% | 69% | 68% |
| lean 3-size,  20k |  3.1s |  48,413 | 2 | 33% | 43% | 56% | 80% |
| lean 3-size, 100k | 15.5s |  63,538 | 4 | 33% | 60% | 23% | 59% |
| lean 3-size, 300k | 48.8s |  70,347 | 9 | 39% | 53% | 22% | 40% |

11x fewer info sets, and — the structural win — **info-set growth is now
bounded**: 48k → 63k → 70k across 20k → 300k iterations, where the rich tree went
657k → 1.4M and kept climbing. The target has stopped moving.

Still not right, though, and worth being clear about what's left. At 300k the
ordering is air 22% < top set 39% ≈ underpair 40% < middle set 53%. Air correctly
settling lowest is new and good. But an underpair matching top set is not a real
strategy, and that is the draw-blind bucketing, not sampling — which is what
phases 3–5 exist to fix. Don't read the remaining gap as "needs more iterations".

**Phase 3 done**: both precomputations are in, and nothing consumes them yet —
they're infrastructure for the vectorized core.

- `public-tree.ts` enumerates the betting tree once into flat typed arrays. The
  whole flop tree is **3,957 nodes in 134 KiB**. It rests on the betting
  structure being independent of *which* runout card is dealt (pot, stacks and
  legal actions after a turn card are the same whatever it was), so a chance node
  has exactly one structural successor and the dealt card rides alongside the
  node index at solve time. The test walks the live and flat trees in lockstep
  using runout cards the builder never saw, which is what actually checks that.
- `showdown-table.ts` precomputes every holding's strength against every runout:
  **1,176 x 1,176 = 5.3 MiB, built in 0.8s**. This takes `evaluateHand` (~740ns a
  call) out of the hot loop and replaces the unbounded string-keyed `bucketCache`,
  which was the thing that would have killed any long run.

**Phase 4 done**: `vector-cfr.ts` is the core, consuming both of the above. It
traverses the public tree once per iteration carrying per-hand reach
probabilities and counterfactual values, so **every holding is updated exactly
on every iteration** — "median visits" stops being a meaningful number, because
it is now the iteration count for every info set in the tree.

Measured on Ks9h4c, 100bb/10bb, seed 12345:

| street | nodes | info sets (node × holding) | solver arrays | build | per iteration |
|---|---|---|---|---|---|
| flop  | 3,957 | 160,425 | 10.3 MiB | 0.78s | 18.1ms |
| turn  |   986 |  39,072 |  1.7 MiB | 0.04s |  4.8ms |
| river |   123 |   4,536 |  0.3 MiB | 0.00s |  0.6ms |

Peak heap over a 200-iteration flop solve is **19.9 MiB for the whole node
process**, which over-counts the solver's share; 5.3 MiB of the flop's 10.3 MiB
is the showdown table. The old sampler needed ~890 MB to hold 1.17M bucketed
info sets and still had them growing.

Two things were harder than the plan implied, both now covered by tests:

- **Card removal at chance nodes needs a scale factor.** The exact
  counterfactual value sums over cards neither holding uses, weighted
  `1/(n-4)`; what's cheap to sample is a card uniform over all `n` with the
  holdings it blocks dropped. Those differ by `n/(n-4)`, and without it every
  line that sees another street is undervalued against one ending in an
  immediate fold — 9% on the flop, compounding again on the turn.
- **Blocked holdings have to be dropped, not just muted.** Zeroing their reach
  keeps them out of terminals but not out of their own regret updates, where
  they'd be scored off a `CONFLICT` rank, i.e. as the worst hand possible. Note
  that this is invisible in the strategy — an all-negative regret vector regret
  matches back to uniform — so it has to be tested on the regrets.

The old bucketed sampler in `cfr.ts` / `infoset.ts` is deliberately still here,
so the two can be compared. Removing it is a separate step.

Then phases 5–6: Nash distance, and the Web Worker + UI.

### The runout abstraction is still K=1, and that is the live limitation

Regrets are keyed on `(public tree node, holding)`. The public tree node records
the street but **not which card fell** — that's what makes a chance node have a
single structural successor and the whole tree 3,957 nodes. So turn and river
strategies are averaged across every runout: the solver cannot play a turned
flush card differently from a turned brick.

Sizing, for whoever picks this up. K=1 is measured here; the rest are the
plan's estimates and have not been checked against a build:

| runout classes | flop pools |
|---|---|
| K=1 (today, 3,957 nodes) | 10 MiB, measured |
| K=4 | ~45 MB, estimated |
| K=8 | ~175 MB, estimated |
| exact (K=47, ~3.1M nodes) | ~5.9 GB, estimated |

Exact runouts are the honest reason a perfect-recall flop solve is not a browser
computation. Texture classes at K=4–8 are affordable and are the natural next
piece of work — but **sequence them after phase 5**, because exploitability is
what measures whether the extra classes bought anything.

Two consequences worth holding on to:

- **A river solve has no runouts left, so it is exact** within the betting
  abstraction. That is why it is the correctness gate for everything here.
- **Any exploitability number computed today is exploitability *within* the
  abstraction**, not the true Nash distance. It has to be reported that way.

### Why cutting bet sizings is not a compromise

Worth knowing before second-guessing phase 2: commercial solvers don't solve rich
multi-size trees either. GTO Wizard's "Dynamic Sizing" starts from many candidate
sizes and **iteratively prunes** — solve, find the size adding least value, remove
it, re-solve, repeat to a target count — with an ML model scoring each size on
frequency, EV and removal regret. The sizes that survive are chosen per decision
point.

Their published cost of doing this:

- single-size river strategy: **0.05% of pot** vs the best alternative single size
- single-size vs an **8-size** river strategy: **0.30% of pot**
- single-size solutions overall: about **0.2bb** of EV

And against Slumbot their **1-size** configuration performed *best*. Their framing:
whether to bet or check matters far more than the size, and once frequencies are
right most sizes have similar EV, especially on early streets. They ship
single-size solutions as a headline feature.

So 50/pot/all-in costs us tenths of a percent of pot — against a flop that
currently returns noise.

Where they're genuinely ahead is that their pruning is **adaptive** (surviving
size varies by spot) where ours is fixed globally. That's a real future
refinement, and it depends on being able to measure what each pruning decision
costs — i.e. it sits on top of phase 5's Nash distance rather than competing with
it. Sequence it there if it's ever wanted.

Sources: [Dynamic Sizing](https://blog.gtowizard.com/dynamic-sizing-a-gto-breakthrough/),
[Dynamic Sizing 2.0](https://blog.gtowizard.com/introducing_dynamic_sizing_2/),
[All you need to know about our solutions](https://blog.gtowizard.com/all-you-need-to-know-about-our-solutions/).

### How many bet sizes we can afford (revisit after phase 4)

Two sizes is constraining — a small c-bet is the standard play on a dry board and
the tree can't express one. It was measured rather than argued. Flop Ks9h4c,
100bb/10bb, 100k iterations, seed 12345, cap 3, all configs also get all-in:

| sizes | config | time | info sets | median visits |
|---|---|---|---|---|
| 2 | **50/pot** (current) |  14.7s |    63,538 | 4 |
| 2 | 33/pot               |  17.4s |    77,487 | 4 |
| 3 | 33/75/pot            |  40.2s |   296,837 | 2 |
| 3 | 33/50/pot            |  49.5s |   439,183 | 2 |
| 3 | 25/50/pot            |  96.8s |   637,032 | 2 |
| 4 | 25/33/50/pot         | 260.1s | 2,549,263 | 1 |

A third size costs 5–10x the info sets and **halves** median visits; a fourth is
40x and lands back at median 1, the level that produces noise. The extra sizing
richness buys strategy we then can't solve for, so it's a net loss today.

Two things that aren't obvious from the headline:

- **Which sizes matter as much as how many.** 33/75/pot (297k) is half the cost of
  25/50/pot (637k). Small bets leave more stack behind and open deeper raise
  sequences, so a 25% bet is disproportionately expensive — not merely "one more
  option".
- **Swapping is cheap, adding is not.** 33/pot is only 22% more than 50/pot. If a
  small c-bet matters more than a half-pot one, that swap is affordable now.
  Deliberately not taken yet, to avoid tuning sizings twice.

**Revisit immediately after phase 4.** Vectorized exact-hand CFR updates every
info set exactly every iteration instead of sampling into them, so sample
starvation stops being the binding constraint (~6 MB for the lean tree). That is
where the headroom for 3–4 sizes lives. Don't retry this before then.

Ignore the strategy percentages in that run — at median 1–4 visits they're noise.

### Two measurements worth not re-deriving

Brute force was tested directly and **does converge, but to a washed-out answer**
(10.5 min, 400k iterations, Ks9h4c):

| iterations | info sets | KK | 99 | AQo | 55 |
|---|---|---|---|---|---|
| 20k  |   656,912 | 80% | 22% | 70% | 83% |
| 150k | 1,173,968 | 69% | 58% | 63% | 83% |
| 400k | 1,399,040 | 55% | 56% | 50% | 38% |

55 does correct itself by 400k. But top set, middle set and pure air all land at
50–56% — the abstraction washing out hand distinctions, not a sampling problem.
That is the evidence for exact hands over more iterations.

Second, **judge coverage by median, not mean.** At 20k iterations the river
(which works) is median 9 visits per info set; turn and flop are both median 1.
The mean flatters all three badly — even the working river solve leaves 84% of
info sets under 30 visits, which is fine, because the lines that get reached are
the ones that get sampled. An earlier "37 per info set" figure was a mean and
should be ignored.

## 0. Finish multi-street solving (this branch - pick up here)

Structurally working, not converged. The river is genuinely correct; the flop is
not. **Do not merge to master as-is** — flop solves are worse than the
single-street version on master, which at least converged.

State as of the last session, solving BTN vs BB on Ks 9h 4c, 100bb, 10bb pot,
20k iterations:

| Street | Info sets | Time  | Quality                                        |
|--------|-----------|-------|------------------------------------------------|
| River  | 2,572     | 0.8s  | Correct: KK bets 72%, 55 checks 66%, AQo 60%   |
| Turn   | 107,805   | 4.7s  | Marginal                                        |
| Flop   | 658,646   | 14.3s | Not converged: 55 bets 66%, AQo bets 70%       |

At 658k info sets and 20k iterations each one is visited ~0.03 times, so regret
matching never gets enough samples and the result is close to the uniform
strategy it starts from.

Next steps, in the order worth trying:

1. **Cut the bet sizings.** This is the biggest lever by far — lines per street
   scale with the action count, and it compounds across three streets, so going
   from 5 sizings to 2 should shrink the tree by roughly an order of magnitude.
   See `BET_FRACTIONS` in `src/solver/game-tree.ts`.
2. **Then re-check convergence.** A test was written for this but never
   finished running: solve at 20k/60k/150k/400k iterations and watch whether
   strong hands separate from weak ones (KK and 99 should get more aggressive
   than 55 and AQo). If the ordering doesn't separate as iterations climb,
   something is structurally wrong rather than just under-sampled.
3. ~~**Verify the tree invariants.**~~ Done — all 9 pass over an exhaustive
   ~290k-node walk (termination, chip conservation, non-negative stacks,
   zero-sum payoffs, street progression, `streetContributed` resets, action
   legality, raise cap, all-in behavior). The walk found two real bugs, both
   float dust, now fixed — see below. The harness is not in the repo; it lives
   in the session scratchpad, so it's worth re-creating as a proper test if this
   branch moves forward.

### Design decisions worth knowing before changing this

- **External-sampling MCCFR** (`traverse` in `src/solver/cfr.ts`). Only the
  traversing player's nodes branch across every action; opponent nodes and
  chance nodes sample one outcome. Full traversal was ~10^6 nodes per iteration
  across three streets, which is hopeless.
- **Hand-strength bucketing** (`handBucket`). Info sets key on the hand's
  strength category on the *current* board rather than the exact holding, so the
  45-turn x 44-river runout explosion collapses. Keying on exact cards OOMs at
  2GB. This is deliberate **imperfect recall** — standard in poker abstraction,
  but it weakens CFR's convergence guarantees and it isn't documented in the
  README yet.
- **Runout cards are stripped from the info set key** (`bettingLine`) for the
  same reason; which card came is already reflected in the strength bucket.
- **OOP acts first on every street** now, which is correct postflop but changed
  which player sits at the root — the UI had to be reworked for it, and the two
  strategy panels read from different nodes (`''` for BB, `'check'` for BTN).
- **Chip amounts are compared with an epsilon** (`EPSILON` / `snapToZero` in
  `game-tree.ts`). Sizing bets off pot fractions leaves float64 dust: after a
  few raises an amount that should be exactly 0 came out as 1.4e-14. Compared
  exactly, that dust made the tree offer fold/call where checking was free, and
  offer all-in to a player whose stack was already empty. Don't reintroduce bare
  `> 0` comparisons on chip amounts.

## 1. Show per-hand strategy in the range grid (priority)

The solver computes a distinct strategy for every holding, but the UI only shows
the single range-wide aggregate in `StrategyTable`. `CFRSolver.getRangeStrategy()`
accepts any `Range`, so a one-combo range returns that hand's own strategy.

- Color each `RangeGrid` cell by its action frequency (e.g. bet vs check) after a
  solve, instead of only by its weight in the range
- Click a cell to show that hand's full action breakdown
- A legend that reflects whichever mode the grid is displaying

Note that cell clicks currently toggle the hand in/out of the range, so showing
per-hand strategy needs a mode switch (edit vs. inspect) or a different gesture.

## 2. Finish the range editor

The scenario is editable now — board, stack, pot, and range membership. What's
left is the finer-grained range work:

- Partial weights: clicking only toggles a hand fully in or out, but `Range`
  already stores fractional weights and `Range.fromString` parses the `AKs:0.5`
  syntax
- Drag to select a block of hands instead of clicking one at a time
- Range presets (UTG/CO/BTN opens, 3-bet ranges, etc.)
- Import/export range strings via `Range.fromString` / `Range.toString`

## Known limitations (not bugs)

- Single street only — the tree goes to showdown when betting closes, with no
  turn/river dealt. Adding a turn card changes the board the hands are evaluated
  against, but the solver still treats it as one betting round.
- Betting is capped at 3 bets/raises per street (`MAX_AGGRESSIVE_ACTIONS`)
- Chance-sampled CFR, so results move slightly run to run; more iterations
  tighten them. `vector-cfr.ts` is seeded, so a given seed does reproduce
  exactly
- **Runouts are abstracted at K=1** in `vector-cfr.ts`: turn and river
  strategies are averaged over which card fell, because the public tree node
  doesn't record it. See "The runout abstraction is still K=1" above — this is
  the largest remaining source of error and it is deliberate, not an oversight
- Only the BTN (in position) strategy is displayed; the BB strategy is solved but
  never surfaced

## Done

- ~~Editable scenario~~ — board (flop/turn/river via card picker), effective
  stack, starting pot, and range membership are all editable; the solved strategy
  clears whenever the spot changes
