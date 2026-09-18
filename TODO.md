# TODO

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
3. **Verify the tree invariants.** Never completed. Worth asserting: chips
   conserved (`pot === contributed[0] + contributed[1]`), payoffs zero-sum,
   `streetContributed` resets to [0,0] on each new street, street never
   regresses, no node is `isChance` on the river, and the 3-bet cap holds.

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
