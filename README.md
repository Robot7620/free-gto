# Free GTO Poker Trainer

An open-source postflop solver for heads-up No Limit Hold'em, in the browser.
React, TypeScript, and a vectorized CFR solver written from scratch.

## What it does

Set a board, two ranges, a stack and a pot, give it a few seconds, and it
returns a strategy - plus a number saying how far from equilibrium that strategy
actually is.

- **Exact hole cards.** Every holding in both ranges is updated on every
  iteration. Hands are not bucketed by strength, so the solver can tell a
  backdoor flush draw from the same rank of air.
- **Multi-street.** Play runs to showdown through the turn and river, with
  betting on each street.
- **Runs off the main thread.** Solving happens in a Web Worker against a time
  budget, so the page stays usable and you can stop it.
- **Says how good the answer is.** Exploitability is measured against a best
  response, reported per deal and as a share of the pot.

## Getting started

Node 18+.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 96 tests
npm run build
npm run bench    # measurement sweeps, not part of the suite
```

## How it works

**The betting tree** is enumerated once into flat typed arrays and reused. Its
structure does not depend on which runout card falls, so a chance node has one
successor per runout class rather than one per card.

**The solver** walks that tree once per iteration carrying a vector of per-hand
reach probabilities and counterfactual values, rather than sampling one holding
per player. Regret matching is per hand, weighted linearly.

**Showdowns** are precomputed: every holding against every runout, so hand
evaluation never runs in the hot loop. Card removal is handled explicitly -
two players cannot hold the same card, and ignoring that biases everything
downstream while still looking plausible.

**Exploitability** best-responds to the solved strategy and reports what that
gains. It is measured *within the abstraction*: a counter-strategy confined to
the same betting tree. A real opponent free to choose any bet size would gain
more, so the true distance from Nash is larger than the number shown.

## What it is not

Being straight about the limits, because the output looks more authoritative
than it is:

- **A river solve is good** - it reaches a few tenths of a percent of pot. A
  turn solve is decent. **A flop solve is not** yet: at the ten seconds the
  default budget allows, it is tens of percent of pot exploitable. The gap is
  runouts, not bet sizes.
- **Runouts are abstracted.** The solver samples one runout per iteration and
  optionally sorts cards into texture classes. Exact runouts - what commercial
  solvers do, via suit isomorphism - are not implemented. That is the single
  biggest thing standing between this and a trustworthy flop solve.
- **Bet sizing is restricted** to 50% pot, pot, and all-in, with at most three
  bets or raises per street. This costs far less than the runout abstraction;
  published work puts a single-size tree within a fraction of a percent of an
  eight-size one.
- **Two players, postflop only.** No preflop solving, no multiway.

`TODO.md` carries the live state, the measured numbers, and what is worth doing
next. It is more current than this file.

## Layout

```
src/engine/    cards, hand evaluation, ranges, combo enumeration
src/solver/    betting tree, showdown tables, the CFR core, exploitability
src/components/  range grid, board, card picker, strategy table
bench/         measurement sweeps, run separately from the tests
```

## License

MIT
