# TODO

## Current state (2026-09-18)

Working through a plan to fix flop convergence by switching to **vectorized
exact-hand CFR** — the architecture real solvers use: abstract the betting tree,
keep hole cards exact. Full plan at
`~/.claude/plans/let-s-go-ahead-and-cryptic-horizon.md`.

**Phase 1 done** (`6842f6b`): vitest, the invariant suite brought into the repo,
a seeded RNG, per-info-set visit counts, and a river ground-truth fixture.
14 tests passing.

**Phase 2 is next** and hasn't been started: make `BET_FRACTIONS` /
`MAX_AGGRESSIVE_ACTIONS` a config object, default to 50/pot/all-in with a 3-bet
cap, collapse the degenerate all-in check-down chains, and raise the iteration
count. Expected to cut the tree ~17x.

Then phases 3–6: precompute the public tree into flat arrays, the vectorized CFR
core, Nash distance, and the Web Worker + UI.

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
  tighten them
- Only the BTN (in position) strategy is displayed; the BB strategy is solved but
  never surfaced

## Done

- ~~Editable scenario~~ — board (flop/turn/river via card picker), effective
  stack, starting pot, and range membership are all editable; the solved strategy
  clears whenever the spot changes
