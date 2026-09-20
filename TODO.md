# TODO

## Current state (2026-09-20)

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
so the two can be compared. Nothing on the page imports it any more; removing
it is a separate step.

**Phases 5–6 done**, on the `texture-classes` branch: exploitability at each
street (and the correction to how it was being measured — see below), runout
texture classes, and the Web Worker + UI. The app runs `VectorCFR` in a worker
on a time budget and displays the exploitability of what it solved. Full
write-up in `.claude/briefs/texture-and-ui-report.md`.

### What K=1 costs: corrected 2026-09-20

**The 20.50% / 56.01% figures previously published in this section were
measured with a clairvoyant best response and are wrong as a statement about
the runout abstraction.** They are kept below, relabelled, because they are
reproducible and because the reasoning built on them needs to be readable
against what it was actually looking at.

What was wrong: `exploitability()` fixed a runout at the root, walked the tree
taking hero's maximum at every node with that runout already loaded, and
averaged afterwards. That is the average of the maxima, not the maximum of the
average - hero's turn decision was being made knowing the river card. A best
response is entitled to every card that is face up when it acts. It is not
entitled to one still in the deck.

It matters because clairvoyance is worth something whatever the strategy does,
so it puts a floor under the number that no amount of solving can lower - and
that floor rises with the count of chance nodes. Which is exactly the shape
this section read as blindness compounding per blind street.

`exploitability()` now averages the runout inside the walk. The old
computation survives as `clairvoyantExploitability()`, named for what it
measures. The two agree to 12 decimals on a river, there being no undealt card
to know about, and the corrected one is pinned on a turn against an
independent reference that does the card-removal arithmetic in the form it is
defined in rather than the form the solver computes it in.

#### The corrected numbers

Board `Ks 9h 4c 2d` rainbow and `Ks 9s 4c 2d` two-tone, seed 12345, exact over
every runout - `exploitability()` enumerates rather than samples at every
depth, so none of this is estimated.

| iterations | rainbow K=1 | rainbow K=4 | two-tone K=1 | two-tone K=4 |
|---|---|---|---|---|
| 8,000 | 14.569% | **12.581%** | 18.169% | **13.492%** |
| 20,000 | 14.403% | **12.035%** | 17.818% | **12.056%** |
| 80,000 | 14.575% | **12.040%** | 18.245% | **11.874%** |

A river, for reference, converges to 0.221% at 20k and is identical at every K
to every digit printed, having no runout to class.

#### The figures as previously published, relabelled

These are `clairvoyantExploitability()`. Reproducible, and not a measurement of
the runout abstraction:

| iterations | river | turn | flop |
|---|---|---|---|
| ~2-4k   | 0.68% | 21.29% | 57.44% |
| ~8-20k  | 0.22% | 20.68% | 54.04% |
| 20-60k  | **0.10%** | **20.50%** | **56.01%** |

The re-run harness reproduces the turn figure - 20.682% at 20k, K=1 - so the
published number was right about what it measured. The reading of it was
wrong. "The turn is blind to one card and costs ~20%, the flop is blind to two
and costs ~55%, compounding per blind street" is equally consistent with
clairvoyance rent compounding per chance node, and that reading additionally
explains why fifteen times the compute never moved it.

#### What actually follows

- **River solves are trustworthy.** 0.22% at 20k, and untouched by K.
- **Turn solves are usable, not marginal.** 12% at K=4, not 20%.
- **Flop solves are the expensive case**, and the corrected flop number is in
  `.claude/briefs/texture-and-ui-report.md` under part 2.
- **Texture classes help, and mainly where a flush is possible.** The claim
  this section previously made - that classing the runout is what makes a flop
  solve worth displaying at all - rested on the inflated figures and does not
  survive them. On the corrected instrument K=4 saves 2.4 points of 14.4 on a
  rainbow turn and 5.9 points of 17.8 on a two-tone one. Real, worth having,
  and a third of the way to what was claimed. The larger gain landing on the
  board where a flush can complete is the mechanism showing up where it should.
- **K=1's penalty is a texture penalty.** K=1 reads 14.4% on a rainbow turn and
  17.8% on a two-tone one - 3.4 points worse for nothing but a flush draw it
  cannot see. K=4 reads 12.0% and 11.9%, the same on both. That, rather than
  the average improving, is the thing classing buys.
- **It is not a sampling question.** Both curves are flat from 20k to 80k on
  both boards.

### The runout abstraction: was K=1, now classed

Regrets are keyed on `(public tree node, holding)`. The public tree node used to
record the street but **not which card fell**, which is what made a chance node
have a single structural successor and the whole flop tree 3,957 nodes: turn
and river strategies were averaged across every runout, and the solver could
not play a turned flush card differently from a turned brick.

**Built on the `texture-classes` branch.** A chance node now gets `classCount`
structurally identical copies of the rest of the tree and the dealt card routes
to the copy for its class. `runoutClass(card, board, K)` in `runout-class.ts`
sorts a card by what it does to *the board it lands on* rather than by its face
value - an offsuit 7 is a brick on one board and the card that pairs the turn
on another.

Sizing, now measured against a build rather than estimated. The estimates that
stood here were about 2x low on nodes, because a flop has two chance levels: the
turn is copied K times and the river K*K.

| runout classes | flop nodes | flop arrays |
|---|---|---|
| K=1 | 3,957 | 10.3 MiB |
| K=4 | 51,111 | 65.1 MiB |
| K=8 | 197,171 | 234.6 MiB |
| exact (K=47) | ~3.1M, estimated | ~5.9 GB, estimated |

**Classes cost memory and samples-per-slot, never time.** A single deal visits
exactly one successor per chance node, so a traversal touches the same node
count whatever K is: 19.1, 19.0 and 18.8 ms per flop iteration at K=1, 4 and 8.
This was not predicted and it is the most reusable fact on the branch - it is
why the UI can offer a time budget without knowing how the runout is classed.
There is a test pinning it.

Exact runouts remain the honest reason a perfect-recall flop solve is not a
browser computation.

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
the single range-wide aggregate in `StrategyTable`. The per-hand data is already
there and does not need a re-solve: `VectorCFR.averageStrategy(node, hand)`
returns one holding's distribution, `handsInClasses(player, ['AKs'])` maps a
grid cell to its holdings, and `aggregateStrategy(node, classes)` is the
weighted roll-up the panels already use. The worker would need to send a
per-hand table back alongside the two aggregates.

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

- Single street only in `cfr.ts`, the old sampler — the tree goes to showdown
  when betting closes, with no turn/river dealt. `vector-cfr.ts`, which the app
  now runs, plays through to the river.
- Betting is capped at 3 bets/raises per street (`MAX_AGGRESSIVE_ACTIONS`)
- Chance-sampled CFR, so results move slightly run to run; more iterations
  tighten them. `vector-cfr.ts` is seeded, so a given seed does reproduce
  exactly
- **Runouts are abstracted into texture classes** in `vector-cfr.ts` — see the
  section above. The solver can tell a flush-completing card from a brick, but
  not two bricks from each other. This is the largest remaining source of error
  on turn and flop solves and it is deliberate, not an oversight
- A flop solve is expensive and the app is honest rather than good about it: a
  ten-second budget is ~416 iterations and lands around 105% of pot, badged
  "indicative only". River solves converge inside the same budget

## Done

- ~~Editable scenario~~ — board (flop/turn/river via card picker), effective
  stack, starting pot, and range membership are all editable; the solved strategy
  clears whenever the spot changes
- ~~Runout texture classes~~ — a chance node gets one successor per class and
  the dealt card routes to its own subtree. Costs memory and samples-per-slot,
  never time. See "The runout abstraction" above
- ~~The exploitability instrument~~ — the best response no longer sees cards
  that have not been dealt. `clairvoyantExploitability()` keeps the old
  computation under a name that says what it does
- ~~The app runs the vectorized solver, in a Web Worker, on a time budget~~ —
  `useSolver.ts` and `solver-worker.ts`. Seconds rather than iterations,
  because an iteration is ~0.6 ms on a river and ~19 ms on a flop. The page
  holds 60 fps through a flop solve
- ~~Exploitability shown beside the strategy~~ — labelled as exploitability
  within the abstraction, not a Nash distance, and posted after the strategy
  because an exact flop pass takes about a minute
