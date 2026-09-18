# TODO

## 1. Make the scenario editable (priority)

The board, ranges, stack, and pot are hardcoded in `App.tsx`'s `useEffect`, so
"Solve This Spot" only ever solves BTN vs BB on K♠9♥4♣ with 100bb and a 10bb pot.
The solver itself already accepts all of these as parameters — it's the UI that
pins them.

- Editable board (card picker, and support turn/river, not just a 3-card flop)
- Editable ranges — `RangeGrid` already renders per-cell buttons and takes an
  `onCellClick`, but nothing is wired to it
- Editable stack depth and pot size
- Range presets, and/or import/export of range strings (`Range.fromString`
  already parses the `AKs:0.5` weighted syntax)

## 2. Show per-hand strategy in the range grid

The solver computes a distinct strategy for every holding, but the UI only shows
the single range-wide aggregate in `StrategyTable`. `CFRSolver.getRangeStrategy()`
accepts any `Range`, so a one-combo range returns that hand's own strategy.

- Color each `RangeGrid` cell by its action frequency (e.g. bet vs check) after a
  solve, instead of only by its weight in the range
- Click a cell to show that hand's full action breakdown
- A legend that reflects whichever mode the grid is displaying

## Known limitations (not bugs)

- Single street only — the tree goes to showdown when betting closes, with no
  turn/river dealt
- Betting is capped at 3 bets/raises per street (`MAX_AGGRESSIVE_ACTIONS`)
- Chance-sampled CFR, so results move slightly run to run; more iterations
  tighten them
