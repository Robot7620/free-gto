# Overnight brief: finish A, settle the flop, then build the UI

You have context for most of this already. Branch `texture-classes`. Machine is
on mains and held awake, so a long run will actually finish.

Three parts, strictly in order. **Each one is worth having on its own.** If you
get through one and stop honestly, that is a good night's work.

## Part 1 - finish what is in flight (must happen)

1. Commit the uncommitted edits to `runout-class.ts` and `vector-cfr.ts`.
2. Fill the three `PENDING` markers in `.claude/briefs/texture-and-ui-report.md`:
   gate 1 (`npm test` green, `npm run build` clean) and gate 3 on the corrected
   instrument.
3. **Correct `TODO.md`.** Its 20.50% / 56.01% figures came from the clairvoyant
   best response and are wrong as published. Give the corrected numbers, keep
   the clairvoyant ones clearly labelled so the history reads straight, and
   revise the conclusion: the claim that texture classes are essential rested on
   those inflated figures, and the corrected evidence says they help modestly
   and mainly where a flush is possible.
4. Push.

## Part 2 - the corrected flop number, and what K should default to

This is the open question your own report flagged as the most questionable thing
on the branch, and it is the ideal thing to spend a long night on: it is
compute-bound, and the answer is a number rather than a judgement call.

- Measure flop exploitability on the **corrected** instrument (`exploitability()`,
  not `clairvoyantExploitability()`) at K=1 and K=4, same seed, same iteration
  counts, on both a rainbow and a two-tone board. The two-tone case matters
  because a rainbow flop has no card that can land in the flush class, so K=4 is
  really K=3 there.
- If the exact enumeration is too slow, say so and use a sampled estimate with
  the sample count reported - but **report which you used**. Do not quietly
  sample and present it as exact.
- Then answer plainly: **should `DEFAULT_RUNOUT_CLASSES` be 1 or 4?** Change it
  if the evidence says so. At K=4 a flop costs 65 MiB against 10 MiB, and per
  iteration they cost the same, so the trade is memory and samples-per-slot
  against strategic resolution. Write down the reasoning, not just the verdict.

## Part 3 - Task B, the Worker and the UI

Only after 1 and 2. The app still runs the **old bucketed sampler**
(`src/solver/cfr.ts`) through `src/App.tsx`.

- Switch it to `VectorCFR`, and move solving into a **Web Worker** with a
  **time budget** ("solve for N seconds") rather than a fixed iteration count,
  posting progress back. Per-iteration cost is flat in K, so the budget does not
  need to know K.
- **Show the exploitability number** beside the strategy. It ranges from ~0.2%
  on a river to double digits on a flop, and a user looking at a flop strategy
  deserves to know which they have. Label it as exploitability within the
  abstraction, not a Nash distance.
- Keep every existing feature working: editable board, editable ranges,
  stack/pot, reset, both strategy panels.
- Leave `cfr.ts` and `infoset.ts` in place. Deleting the old sampler is a
  separate decision.

### Gates for Part 3

1. `npm test` green, `npm run build` clean.
2. **Drive the app in a real browser.** Playwright and chromium are installed at
   `/private/tmp/claude-501/-Users-andyzhou-Projects/9f389724-8329-40a0-a2c2-c53ac913e6dd/scratchpad/pw-test`
   with working driver scripts to copy. Solve a spot, change the board, edit a
   range, solve again. Read `console --errors` and look at a screenshot. A build
   that compiles is not a working app.
3. The UI must stay responsive while solving - that is the whole point of the
   worker.

## Rules that carry over

- **Never tune a measurement to make a gate pass.** A negative result is a
  result. Tonight's most valuable finding came from a gate failing honestly.
- **No `Co-Authored-By` or AI attribution in commits.** Standing rule. Match the
  existing prose style; read `git log` first.
- Commit incrementally and push as you go, so a sleep or a crash costs minutes
  rather than hours.
- Do not merge, force-push, or rebase shared history. Do not touch `master` or
  `multi-street`.
- If you need a design decision this brief does not cover, stop and write it
  down rather than guessing.

## Report

Update `.claude/briefs/texture-and-ui-report.md` as you go rather than at the
end - if the session dies, what is written survives. Cover, for each part: what
landed commit by commit, every gate passed/failed/not-reached with real numbers,
what you assumed, and what you would check first next.

Accuracy over optimism. The suite will be re-run and the app opened by hand.
