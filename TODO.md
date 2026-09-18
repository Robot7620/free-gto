# TODO

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
