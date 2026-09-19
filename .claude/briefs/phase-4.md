# Overnight brief: Phase 4, the vectorized exact-hand CFR core

You are picking this up cold. Read this whole file before writing code, then
read `TODO.md` (section 0 and "Current state") and
`~/.claude/plans/let-s-go-ahead-and-cryptic-horizon.md`.

Work on branch `phase-4`, cut from `multi-street`. Do not touch `master`.

## Why this exists

The solver gets the river right and the flop wrong. The cause is not
under-sampling - it's that info sets are keyed on a *hand-strength bucket*
(`evaluateHand(...).value >>> 16`, i.e. category + top rank), which is
draw-blind: `A♠5♠` on `K♠9♠4c` and `A♦5♣` land in the same bucket. Flop play is
largely about which air has equity to semi-bluff, so no amount of compute fixes
it. This was measured - 400k iterations converges, and converges to top set,
middle set and pure air all sitting at 50-56%.

The fix is the architecture real solvers use: abstract the *betting tree*, keep
*hole cards exact*, and iterate over the public tree carrying a vector of
per-hand values instead of sampling one holding per player.

## What is already built and verified - do not rebuild these

- `src/solver/public-tree.ts` - the betting tree enumerated once into flat typed
  arrays. Flop tree is 3,957 nodes / 134 KiB. Chance nodes have exactly one
  structural successor, because the betting structure does not depend on which
  card was dealt. Tested against the live tree using runout cards the builder
  never saw.
- `src/solver/showdown-table.ts` - every holding's strength against every runout,
  1,176 x 1,176 = 5.3 MiB, built in 0.8s. Removes `evaluateHand` from the hot
  loop.
- `src/solver/showdown-values.ts` - terminal values across a whole range, with
  per-card blocking handled. **Read the comments in this file carefully.** It has
  a naive reference (`showdownValuesNaive`, `foldValuesNaive`) that is obviously
  correct, and a fast sweep checked against it over 400 randomized spots. It also
  documents a precondition: rank is a function of the cards. Respect that.
- `src/solver/rng.ts` - seeded PRNG. Use it; determinism is what makes the
  fixtures meaningful.

## The task

Write `src/solver/vector-cfr.ts`: CFR that traverses the public tree once per
iteration carrying per-hand reach probabilities and counterfactual values.

- Hands come from `enumerateRangeCombos` in `src/engine/combos.ts`. Ranges are
  small after board removal (~96 BTN / ~129 BB), which is what makes this
  affordable.
- Store regrets and strategy sums in pooled `Float32Array`s indexed by
  `(node, hand, action)`. Keep `strategySum` in Float64, or hold a running
  weighted average - with linear weighting the sum grows like T^2 and late
  increments vanish in Float32.
- At a decision node: regret-match per hand, recurse per action with the acting
  player's reach scaled by sigma, then accumulate
  `regret[h][a] += v_a[h] - v[h]`.
- At terminals: call into `showdown-values.ts`. Do not reimplement that
  arithmetic.
- At chance nodes: sample one runout card, and use it to index the showdown
  table. See the decision below about what this means for info sets.
- Add Linear CFR weighting (`addRegret(a, t * r)`) - one line, O(1). Prefer it
  over CFR+, whose hard regret flooring interacts badly with sampled values.

## Decisions already made - do not re-litigate these

1. **Runout abstraction stays at K=1 for this pass.** Regrets are keyed on
   `(public tree node, hand)`. The public tree node does not encode which card
   fell, so turn and river strategies are averaged across runouts. This is a
   known, deliberate limitation. Exact runouts would be ~3.1M nodes and ~5.9 GB;
   texture classes are a contained follow-up, NOT part of this task.
   Document the limitation in `TODO.md`. Do not attempt texture classes.
2. **A river solve has no runouts, so it is exact.** That is the correctness
   gate. Use it.
3. **Do not delete the old bucketed sampler** (`cfr.ts`, `infoset.ts`) in this
   run, even once the new one works. Leaving both lets the results be compared.
   Removal is a separate, deliberate step.
4. **Do not touch the UI** (`src/App.tsx`) or add a Web Worker. That is Phase 6
   and it should not be built on solver output nobody has reviewed.

## Hard gates

Nothing is finished until all of these hold. Run them yourself, do not assume.

1. `npm test` - all existing tests green. There were 40 before you started.
2. `npm run build` - clean.
3. **River exactness.** Solve the river fixture spot
   (`src/solver/__tests__/river-fixture.test.ts`) with the vectorized solver.
   Assert: every hand's strategy is a valid distribution summing to 1; the root
   value for the two players sums to ~0 (zero-sum); and repeated runs with the
   same seed are identical.
4. **Agreement with the existing solver on the river.** The sampled solver is
   believed correct there. Strong hands should still be more aggressive than weak
   ones, in the same order. Exact frequencies will differ - the vectorized one is
   exact where the sampled one is noisy - so compare ordering and rough
   magnitude, not equality.
5. **Memory.** Report peak heap for a flop solve. If it exceeds ~500 MB, stop and
   report rather than pushing on.
6. Write new tests for anything you add. Follow the existing style: check against
   a reference implementation or an invariant, not against numbers you produced
   and then pasted in.

## Stop conditions - prefer stopping to pushing through

Stop, commit what works, and write up what happened if any of these occur:

- A gate fails and the fix is not obvious within the scope of this task.
- The vectorized and sampled solvers disagree on the river in a way you cannot
  explain. **Do not loosen a tolerance to make a comparison pass.** That is the
  single most damaging thing you could do here - it converts a detected bug into
  an undetected one.
- You find yourself needing a design decision this brief does not cover.
- Memory or runtime is wildly off the estimates above.

A partial phase with an honest write-up is a good outcome. A complete-looking
phase built on a silenced check is not.

## Commit protocol

- Commit incrementally, so partial progress survives. Push to `phase-4`.
- **Never add `Co-Authored-By` or any Claude/AI attribution to commits.** This is
  a standing rule for this repo. Commit messages are prose explaining why, in the
  style of the existing history - read `git log` before writing your first one.
- Do not merge anything. Do not force-push. Do not rebase shared history.

## Morning report

Finish by writing `.claude/briefs/phase-4-report.md` covering:

- What landed, commit by commit.
- Every gate: passed, failed, or not reached - with the actual numbers
  (info set counts, memory, timings, river comparison figures).
- Anything you were unsure about, and what you assumed.
- What you would do next, and what you would check first.

Be accurate over optimistic. The person reading this will run the test suite
themselves, so a report that oversells will simply be caught.

## If and only if every gate passed, and there is time left

Phase 5, Nash distance. Start this **only** if all six gates above genuinely
passed. If any gate failed, or you stopped early, do not start it - write the
report instead. A half-built Phase 5 on top of an unverified Phase 4 is worth
less than nothing, because it produces an authoritative-looking number derived
from unchecked math.

Phase 5 is the natural continuation precisely because it *checks* Phase 4:
exploitability is the measure of whether the solve actually converged.

- Compute the exploitability of the solved strategy against a best response, as a
  percentage of pot. One non-iterative pass over the tree, not a second solve.
- Populate the unused `exploitability?` field on `CFRResult`.
- Calibration: commercial solvers target 0.1-0.3% of pot and treat under 1% as
  the onset of convergence. Report the number; do not tune anything to hit it.
- Be careful about what the number means. With hands now exact, the hand
  dimension is perfect-recall again, but runouts are still abstracted at K=1
  (see decision 1), so this is exploitability *within the abstraction*, not in
  the real game. Say so plainly wherever it is reported. Do not describe it as
  the true Nash distance.

Do not start Phase 6 (Web Worker, UI) under any circumstances.
