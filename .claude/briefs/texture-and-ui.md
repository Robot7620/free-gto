# Brief: runout texture classes, then the UI

You are picking this up cold. Read this file, then `TODO.md` (all of it - the
measured tables matter), then `.claude/briefs/phase-4.md` for how the solver got
here.

Branch off the current head of `phase-4`. Do not touch `master` or
`multi-street`.

## Two tasks, strictly in this order

**A. Runout texture classes.** This is the priority and the one that must land.
**B. Web Worker + UI.** Only if A fully passes its gates.

They are sequenced, not parallel: B depends on A's memory and per-iteration cost,
so doing B first means doing it twice. **One finished task beats two half-ones.**
If A consumes the whole session, that is a good outcome - say so in the report
and stop.

## Why A matters

Exploitability per street, measured, after phase 5:

| | river | turn | flop |
|---|---|---|---|
| converged | **0.10%** of pot | **20.50%** | **56.01%** |
| more compute helps? | yes | no | no |

The river converges. The turn and flop hit a floor that fifteen times the
compute does not move. The floor is the K=1 runout abstraction: regrets are keyed
on `(public tree node, holding)` and the node records the street but not which
card fell, so the strategy plays a flush-completing turn exactly like a brick.
The turn is blind to one card and costs ~20%; the flop is blind to two and costs
~55%. It compounds per blind street.

This is real exploitability, not an artifact - the board is public, so an
opponent betting only the scary card collects that difference.

## Task A: texture classes

Group each runout card into one of K classes by its relationship to the board,
and put the class into node identity, so the solver can play differently
depending on what kind of card arrived.

- Add `runoutClass(card, board): number` returning `0..K-1`. A reasonable
  starting scheme, which you should feel free to improve if exploitability says
  so: does it pair the board / does it bring a flush (matches the suit of two or
  more board cards) / is it an overcard to the board's top card / otherwise a
  brick. Start at **K=4**.
- `buildPublicTree` currently gives a chance node one structural successor,
  because the betting structure doesn't depend on the card. That stays true
  *within* a class but not across classes, so `chanceChild` becomes one
  successor per class. The tree grows roughly K-fold per chance node.
- The solver samples a card as it does now, then routes to the successor for
  that card's class.

Estimates to sanity-check against, from the plan: K=4 is ~24k nodes and tens of
MB; K=8 is ~92k nodes and a few hundred MB. Measure rather than trust these.

### Gates for A

1. `npm test` green - 60 tests before you start - and `npm run build` clean.
2. **The river is unchanged.** A river has no runout, so texture classes cannot
   affect it. Its exploitability must stay ~0.10% and its strategy must match
   K=1 to within noise. If the river moves, the change is wrong somewhere. Add
   this as a test; it is the sharpest check available.
3. **Turn and flop exploitability must measurably improve** on 20.50% and
   56.01%. That is the entire point. Report the numbers for K=1 and K=4 side by
   side, same seed, same iteration counts.
4. **Memory** under ~500 MB for a flop solve. Report peak.
5. If K=4 clears all of the above and memory allows, measure **K=8** too and
   report both. Do not adopt K=8 blindly - report the trade.

## Task B: Web Worker and UI - only if A passed

The app still runs the **old bucketed sampler** (`src/solver/cfr.ts`) via
`src/App.tsx`. Phase 6 is switching it to `VectorCFR` and getting it off the main
thread.

- Move solving into a Web Worker with a **time budget** ("solve for N seconds")
  rather than a fixed iteration count, posting progress back.
- **Display the exploitability number** next to the strategy. This is the honest
  move: it varies enormously by street, and a user seeing a flop strategy
  deserves to know how far from equilibrium it is. Label it as exploitability
  within the abstraction, not a Nash distance.
- Keep every existing feature working: editable board, editable ranges,
  stack/pot, reset, and the two strategy panels.
- Leave `cfr.ts` and `infoset.ts` in place. Deleting the old sampler is a
  separate decision and not yours to take here.

### Gates for B

1. Tests green, build clean.
2. **Actually run the app and drive it in a browser.** Playwright and chromium
   are already installed under
   `/private/tmp/claude-501/-Users-andyzhou-Projects/9f389724-8329-40a0-a2c2-c53ac913e6dd/scratchpad/pw-test`
   - there are working driver scripts there to copy. Solve a spot, change the
   board, edit a range, solve again. Check the console for errors and look at a
   screenshot. A build that compiles is not a working app.
3. The UI must stay responsive while solving - that is the point of the worker.

## Stop conditions

Stop, commit what works, write the report:

- A gate fails and the fix isn't obvious within scope.
- Texture classes don't improve exploitability. **Do not tune the measurement
  until they appear to.** A negative result here is genuinely valuable - it
  would mean the classing scheme is wrong, and that is worth knowing.
- Memory or runtime goes badly off the estimates.
- You need a design decision this brief doesn't cover.

## Commit protocol

- Commit incrementally and push to your branch.
- **Never add `Co-Authored-By` or any AI attribution.** Standing rule. Read
  `git log` for the prose style before your first message.
- Do not merge, force-push, or rebase shared history.

## Report

Write `.claude/briefs/texture-and-ui-report.md`:

- What landed, commit by commit.
- The K=1 vs K=4 (vs K=8) exploitability table, with seeds and iteration counts.
- Peak memory and per-iteration cost at each K.
- Every gate: passed, failed, or not reached.
- What you assumed, and what you'd check first next.

Accuracy over optimism - the tests will be re-run and the app opened by hand.
