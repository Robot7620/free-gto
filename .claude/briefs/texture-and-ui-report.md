# Report: runout texture classes, and the UI

Branch `texture-classes`, cut from `phase-4` at `81d77b2`. Pushed.

**Task A landed in the first session. Task B landed in the second**, along with
the corrected flop measurement A left open. The three parts of the overnight
brief are reported in their own sections below; this first half is the original
Task A report, kept as written except where it said Task B had not been started.

## The short version

Texture classes are implemented, tested, and cost far less than feared - per
iteration they cost *nothing*, which the plan did not predict. The river is
provably untouched by them.

But **on the gate as written, they do not pay.** At equal iteration counts K=4
is slightly worse than K=1 on the turn and K=8 clearly worse. I did not tune
anything to make that go away.

Chasing why turned up something larger, and it is the part of this report worth
reading twice: **the exploitability number the gate was written against was
measuring the wrong thing.** The best response was being handed the whole runout
before it acted, so its turn decisions were made knowing the river card. That
puts a floor under the measurement that no strategy can lower, and the floor
rises with the number of chance nodes - which is exactly the pattern phase 5
read as blindness compounding per street. I fixed it, pinned the fix against an
independent reference, and re-measured.

**On the corrected instrument the verdict reverses on the turn.** K=4 beats
K=1 at every checkpoint on both boards - 14.4% to 12.0% on a rainbow turn,
17.8% to 11.9% on a two-tone one - with the larger gain on the board where the
flush class is reachable at all. Both curves are flat from 20k to 80k, so this
is not sample starvation either way.

**And on the flop it reverses harder.** Measured overnight: K=1 stops dead at
38.6% rainbow and 51.5% two-tone and ten times the compute moves neither, while
K=4 crosses below it around 5,000 iterations and reaches 33.3% and 32.9%, still
falling at 80,000. On a two-tone flop that is an 18.6 point gap. The whole
original paradox has a quantitative explanation as well: the rent clairvoyance
collects is flat in iterations but *rises with K*, by 6.7 points on the rainbow
board and 10.5 on the two-tone one, so the instrument the gate was written
against charges a better abstraction a fee of the same order as its
improvement. See part 2.

## What landed, commit by commit

| commit | what |
|---|---|
| `e9630ae` | `runoutClass(card, board, K)` - K=1/4/8, K=8 a strict refinement of K=4. Nothing consumed it yet. |
| `0d614af` | `buildPublicTree` gives a chance node one successor per class. `classCount` defaults to 1, rebuilding the old tree exactly. |
| `f907bc1` | The solver classes the dealt card and routes to that class's subtree. Default K=4. |
| `c03d068` | The best response stops seeing cards that have not been dealt. |
| `837b3fb` | `bench/` out of `npm test`, behind `npm run bench`. |

## Sizes and costs, measured

Board `Ks 9h 4c`, 100bb, 10bb pot, ranges as in the existing tests.

| | K=1 | K=4 | K=8 |
|---|---|---|---|
| flop nodes | 3,957 | 51,111 | 197,171 |
| turn nodes | 986 | 3,575 | 7,027 |
| river nodes | 123 | 123 | 123 |
| flop regret slots | 407,025 | 5,196,825 | 20,006,325 |
| flop solver arrays | 10.3 MiB | **65.1 MiB** | **234.6 MiB** |
| flop ms/iteration | 19.1 | 19.0 | 18.8 |

Two things to take from this.

**The brief's node estimates were ~2x low** (K=4 ~24k estimated, 51,111 actual;
K=8 ~92k estimated, 197,171 actual). A flop has two chance levels, so the turn
is copied K times and the river K*K.

**Per-iteration cost is flat in K.** This was not in the plan and it is the most
reusable fact here: a single deal visits exactly one successor per chance node,
so a traversal touches the same nodes whatever K is. Classes cost memory and
samples-per-slot. They never cost time. There is a test pinning it, because the
whole approach rests on it.

## The measurement

Seed 12345 throughout, exploitability exact over every runout (48 on a turn,
2,352 ordered runouts on a flop - not sampled).

### Gate 3 in its own terms: the clairvoyant instrument

This is the instrument phase 5 used and the one the 20.50% / 56.01% figures in
`TODO.md` come from. Board `Ks 9h 4c 2d`.

| iterations | K=1 | K=4 | K=8 |
|---|---|---|---|
| 2,000 | **22.357%** | 27.077% | 29.745% |
| 8,000 | **20.628%** | 21.620% | 24.123% |
| 20,000 | **20.682%** | 20.933% | 23.285% |

K=1 at 20k reproduces the 20.50% in `TODO.md` to within drift, so the harness
agrees with the published figure. **Gate 3 fails on the turn**: at equal
iteration counts - which, per-iteration cost being flat, is also equal wall
clock - K=4 is marginally worse and K=8 clearly worse.

The river, for contrast, is *identical* at every K, to every digit printed:

| iterations | K=1 | K=4 | K=8 |
|---|---|---|---|
| 2,000 | 1.147% | 1.147% | 1.147% |
| 8,000 | 0.428% | 0.428% | 0.428% |
| 20,000 | 0.221% | 0.221% | 0.221% |

### What the instrument was actually measuring

`exploitability()` fixed a runout, walked from the root taking hero's maximum at
every node with that runout already loaded, and averaged the results afterwards.
That computes the average of the maxima, not the maximum of the average: **hero's
turn decision was made knowing the river card.**

`TODO.md` defends the best response seeing the card that fell - "It sees which
card fell, but so does any opponent - the board is public" - and that is right.
It is also what makes hero free to play each class its own way *below* a chance
node. It does not defend seeing a card still in the deck, and that is what the
code did.

Why it matters for reading phase 5: clairvoyance is worth something whatever the
strategy does, so it puts a floor under the number that no amount of solving can
lower - and the floor rises with the count of chance nodes:

| | chance nodes | reported floor |
|---|---|---|
| river | 0 | 0.10% |
| turn | 1 | 20.5% |
| flop | 2 | 56% |

`TODO.md` reads that shape as blindness compounding per blind street. It is
equally consistent with clairvoyance rent compounding per chance node, and that
reading also explains why fifteen times the compute never moved it.

`exploitability()` now averages the runout inside the walk: hero gets one choice
above a chance node, scored against the average over cards, and a free choice
below it once the card is public. The old computation survives as
`clairvoyantExploitability()`, named for what it measures.

**The fix is checked, not asserted.** On a river the two agree to 12 decimals,
there being no undealt card to know about. On a turn the enumerating form is
pinned against a naive reference that walks the live recursive tree, enumerates
the cards explicitly, and does the card-removal arithmetic in the form it is
*defined* in - average over the cards not in hero's hand, normalised by the n-4
legal for each villain holding - rather than the form the solver *computes* it
in - sum over all n cards, kill what each blocks, scale the vector by n/(n-4).
Same number, genuinely different computation; they agree to 9 decimals at K=1
and K=4.

### Gate 3 on the corrected instrument

Same seed, same iteration counts, same solver. Only the instrument changed, and
the verdict reverses: **K=4 beats K=1 on the turn on every board and at every
checkpoint.** `exploitability()` enumerates the runout inside the walk at every
depth, so every number here is exact and none of it is sampled.

| iterations | rainbow K=1 | rainbow K=4 | two-tone K=1 | two-tone K=4 |
|---|---|---|---|---|
| 8,000 | 14.569% | **12.581%** | 18.169% | **13.492%** |
| 20,000 | 14.403% | **12.035%** | 17.818% | **12.056%** |
| 80,000 | 14.575% | **12.040%** | 18.245% | **11.874%** |

Three things in that table, and the second is the one worth the branch.

**Both curves are flat from 20k to 80k.** K=4 is not starved on a turn - it has
converged by 20,000 iterations and four times the compute moves it by two
hundredths of a point. The sample-dilution suspicion, which was the leading
explanation for the negative result, is ruled out here. Whatever K=4 is worth
on a turn, it is worth it at 20k.

**The gain is where the mechanism is.** On the rainbow board K=4 saves 2.4
points, 16% of the number. On the two-tone board it saves 5.9 points, 33%. A
rainbow turn has no suit with two cards on it, so no river card can fall in the
flush class and K=4 is really K=3 - the mechanism the whole idea rests on
cannot occur there. Where it can occur, the gain nearly doubles. That is not a
number moving; that is the stated mechanism showing up in the one place it was
predicted to and not in the other.

**K=1 is punished by texture and K=4 is not.** Read the K=1 column down the two
boards: 14.4% rainbow against 17.8% two-tone. The same solver, the same
iterations, 3.4 points worse purely because the board has a flush draw it
cannot see. K=4 lands at 12.0% and 11.9% - the same number on both. Classing
the runout does not just improve the average, it removes the penalty that board
texture imposes on a solver blind to it, which is exactly what it was for.

For contrast with the clairvoyant table above, where K=4 read *worse* on the
turn at every checkpoint: nothing about the solve changed between these two
tables. Only what the best response was allowed to know.

## Gates

| gate | verdict |
|---|---|
| 1. `npm test` green, `npm run build` clean | **Passed** - 84 tests in 12 files, 40.2 s; `tsc` clean, `vite build` in 709 ms |
| 2. River unchanged | **Passed**, in the sharpest form available |
| 3. Turn and flop measurably improve | **Turn passes** on the corrected instrument - 14.4% -> 12.0% rainbow, 17.8% -> 11.9% two-tone. **Fails on the clairvoyant one**, which is the instrument the gate was written against. The flop is part 2. |
| 4. Flop memory under ~500 MB | **Passed** - 65.1 MiB of arrays at K=4, 234.6 MiB at K=8 |
| 5. K=8 measured and reported, not adopted blindly | **Passed** - measured, and not adopted |

### Gate 2, in detail

This is the one I would point a reviewer at first, because it is the only check
here that can be made airtight. A river has no runout, so classing one is
meaningless: the tree, the slot layout and the random stream are the same
sequence at every K. So the assertion is **exact equality, not a tolerance** -
every holding's average strategy at every decision node, bit for bit, at K=1,
K=4 and K=8. A tolerance would have hidden exactly the bug it is looking for.

The turn half of the same test is the other direction. On `Ks 9s 4c 2d` the only
suit with two board cards is spades, so *every* card in the flush class is a
spade and *no* card in any other class is. `AsQs` therefore holds the nut flush
in the flush class and ace-high in the brick class, with nothing in between and
no card in either class where that is untrue. It folds **0.0%** facing a
half-pot river bet in the first and **83.6%** in the second. At K=1 those are
necessarily the same number, because they are the same node.

## What I assumed

- **K=4 as the default.** `DEFAULT_RUNOUT_CLASSES = 4`. Given the result, this
  is the most questionable thing on the branch - see below.
- **Precedence in the class scheme.** A card that both pairs the board and
  brings a flush is filed under the pair. Something had to break the tie or the
  same card would route two ways; I did not test alternatives.
- **Classing against the board as it stands.** A river is classed against the
  flop *plus the turn*, so a river that pairs the turn is a pairing card. The
  alternative - classing everything against the root board - seemed clearly
  worse and I did not measure it.
- **Fixing the instrument was in scope.** This is a judgment call and worth
  flagging as one. It is arguably phase 5's work. I judged that gate 3 could not
  be evaluated at all through an instrument that inflates the number in
  precisely the dimension the gate is about.
- **Adding a two-tone board.** The brief's `Ks 9h 4c` is rainbow, so no card can
  ever fall in the flush class and K=4 is really K=3 there - the mechanism the
  idea rests on cannot occur on it. I measured the two-tone variant alongside,
  not instead.

## What I would check first next

*Written at the end of task A. Items 1, 3 and 4 were checked overnight - see
part 2 below. Item 3 was half right: dilution is exactly what is happening
below a few thousand iterations, and is not what is happening at convergence,
where both curves are flat. Item 4 does not survive it - the class scheme is
not wrong, it is slow to pay for itself. Item 2 is still open.*

1. **Whether K=4 should be the default at all.** On the evidence here it should
   probably be 1 until the corrected instrument says otherwise on a flop. The
   constant is one line and every test passes either way.
2. **Unreachable classes waste memory.** On a rainbow flop *no* turn card can be
   in the flush class, so a quarter of the turn subtrees are allocated and never
   touched. Reachability is cheap to compute per chance node - enumerate the
   remaining cards and class them - and would cut K=4 memory by roughly a
   quarter on rainbow boards and more at K=8.
3. **Sample dilution is the live suspect for the negative result.** A traversal
   updates only the class subtree it routes into, so K=4 gets a quarter of the
   updates per slot. K=4's curve is still falling steeply where K=1's has
   flattened. If that is the whole story, the fix is not a different class
   scheme but more iterations, and the trade is worse at fixed wall clock.
4. **The class scheme itself is the other suspect.** Pair/flush/overcard/brick
   may simply not be the dimension that matters. The K=8 result being *worse*
   than K=4 at equal iterations is consistent with dilution rather than with the
   extra splits being wrong, but it does not separate them.

## What A established that B needed

Written before B was built, and worth keeping because every line of it turned
out to be load-bearing:

- **A time budget is the right control, not an iteration count.** Per-iteration
  cost is flat in K and stable: ~19 ms on a flop, ~4.7 ms on a turn, ~0.6 ms on
  a river. Iterations per second is predictable, so "solve for N seconds" maps
  cleanly onto it.
- **Memory is not the constraint it was feared to be.** 65 MiB at K=4 on a flop,
  including the 5.3 MiB showdown table. A worker can hold this comfortably.
- **The build is not free**: ~0.9 s for a flop, almost all of it the showdown
  table. That belongs inside the worker, behind the progress reporting, or the
  UI stalls before the first iteration.
- **Displaying exploitability needs care now.** There are two numbers and they
  differ by a lot on a flop. The one to show is `exploitability()`. It should be
  labelled as exploitability *within the abstraction* - hands are exact, runouts
  are classed - and never as a Nash distance.
- **An exploitability pass is not free either.** On a flop it enumerates all
  2,352 ordered runouts. It should be computed once when the solve finishes, not
  polled during it.

---

# The overnight brief

Three parts, in order. Part 1 tidied up what the first session left in flight,
part 2 answered the question that session flagged as the most questionable
thing on the branch, and part 3 built the worker and the UI.

## Part 1 - what was in flight

| commit | what |
|---|---|
| `f5277a6` | The comments over `runoutClass` and `DEFAULT_RUNOUT_CLASSES` were still quoting the clairvoyant ~20% / ~55% figures and claiming an improvement for K=4 that only the corrected instrument shows. Both now carry measured numbers and say where the gain comes from. |

Gate 1 is filled in the gate table above: 84 tests in 12 files green in 40.2 s,
`tsc` clean, `vite build` clean in 709 ms - measured before any of tonight's
code was written, so it is a verdict on task A rather than on tonight.

`TODO.md` is corrected in its own commit; see part 2, since the correction
needed the flop number part 2 produces.

## Part 3 - the worker and the UI

Taken out of order in this write-up because part 2 is a measurement that ran
for hours while this was being built. It landed in `152508f`.

### What changed

The page was driving `CFRSolver` - the old strength-bucketed sampler - from the
main thread, in 5,000-iteration slices with a `setTimeout(0)` between them, for
a fixed 200,000 iterations. All three of those are now different.

**`VectorCFR` instead of `CFRSolver`.** Hole cards are exact and every holding
in both ranges updates on every iteration. `cfr.ts` and `infoset.ts` are
untouched and still tested; nothing on the page imports `CFRSolver` any more.

**A time budget instead of an iteration count.** 200,000 iterations is about
two minutes on a river and about an hour on a flop, because an iteration is
~0.6 ms on one and ~19 ms on the other, so the same number means nothing in
common across boards. The worker now takes seconds: it runs a four-iteration
probe, measures its own rate, and sizes each subsequent chunk at ~150 ms,
clamped to what is left of the budget and never below one iteration. Per
iteration the cost is flat in K, so the budget never has to know how the runout
is classed - which is the fact task A turned up and the reason this works.

**A Web Worker.** Slicing on the main thread hid the problem rather than
solving it: a single flop iteration is 19 ms of typed-array arithmetic that
nothing can interrupt. And it could not have hidden the exploitability pass at
all, which is one uninterruptible synchronous walk.

Cancellation is `worker.terminate()` from the page, not a message. The worker
loop never yields, so a stop message would sit unread until the thing it was
sent to stop had already finished. Every reply carries the id of the request
that caused it and stale ids are dropped, because terminate does not recall a
message already in flight.

### Showing exploitability

It is posted in its own message *after* the strategy, not with it. An exact
flop pass took **67.2 s** in the browser - longer than most solves - and
holding a finished strategy back behind a measurement of it would be the wrong
trade. The panel says "Measuring..." in the meantime and states that the
strategy above is already final.

The number shown is `exploitability()`. The label is careful, because the
number is easy to over-read: a best response confined to this same betting tree
counter-plays every hole-card combination and every runout card separately, so
those dimensions are honest, but it may only choose among the bet sizes the
tree offers. A counter-strategy free to bet any size gains more. The panel says
so, and says not to read it as a Nash distance.

A coloured verdict sits beside it - converged under 1%, approximate under 15%,
indicative only above - with thresholds taken from the measurements on this
branch rather than chosen for looks.

### Gates

| gate | verdict |
|---|---|
| 1. `npm test` green, `npm run build` clean | **Passed** - 91 tests in 13 files, 41.7 s; `tsc` clean, `vite build` in 832 ms, worker emitted as its own 27.6 kB chunk |
| 2. Driven in a real browser | **Passed** - see below |
| 3. UI responsive while solving | **Passed** - 16.7 ms median frame delta during a flop solve |

### Gate 2, in detail

Headless chromium against the dev server, driving the app the way a person
would. Every number below is from that run.

| step | result |
|---|---|
| Load, default flop `Ks 9h 4c` | renders, button enabled |
| Solve 8 s | 416 iterations, 51,111 nodes, 5,196,825 slots, 65.1 MiB - matching task A's sizing table exactly |
| Exploitability pass | landed 67.2 s later at **105.51% of pot**, badged "indicative only" |
| Add `2d` `7s` -> river | strategy cleared by the edit |
| Solve 5 s | 7,732 iterations, 123 nodes, **0.44% of pot** |
| Remove `AA` from BTN | total combos 108.0 -> 102.0, strategy cleared |
| Solve 5 s | 8,093 iterations, 12,810 slots, **0.42% of pot** |
| Stack to 40bb, solve 5 s | 12,462 iterations, 75 nodes, **0.35% of pot** |
| Reset to default | board, ranges, stack 100, pot 10, seconds 10 all restored |
| Stop mid-solve | button returns to idle, no stray messages afterwards |
| `console --errors` | **none**, and no page errors |

Screenshots taken at the initial load, mid-measure, flop done, river done,
range edited and after reset.

Driven again against `vite preview` on the production bundle, not only the dev
server, since a worker loaded through `new URL(..., import.meta.url)` is one of
the things that can work under dev's module graph and not after bundling. It
loads from its own emitted chunk and solves: 4,407 iterations in 3.0 s on a
river, 0.65% of pot, no console errors.

### Gate 3, in detail

This is the one the worker exists for, so it was measured rather than asserted.
A `requestAnimationFrame` loop sampled frame-to-frame deltas on the main thread
throughout a flop solve - the heaviest case, 19 ms per iteration:

| | ms |
|---|---|
| frames sampled | 185 |
| median delta | 16.7 |
| p95 delta | 16.8 |
| worst delta | 66.6 |

A clean 60 Hz through the median and the p95; 16.7 ms is the frame budget
itself, so the main thread was doing nothing but rendering. A real interaction
during the solve - focusing an input and waiting two frames - completed in
**28.4 ms**. The single 66.6 ms outlier is four dropped frames, once, and lines
up with worker startup and module load rather than with the solve.

For contrast with the old arrangement: a 5,000-iteration slice of the sampled
solver held the main thread for as long as it took, and the same page with a
flop-sized `VectorCFR` slice would have been 19 ms of hard block per iteration.

### What I assumed in part 3

- **The budget times solving, not building.** The showdown table takes ~0.9 s on
  a flop and is excluded from the clock, so "8 seconds" was 8.8 s of wall time
  in the browser. Building has its own status so the button is never silently
  stalled. The alternative - counting the build against the budget - makes a
  short budget on a flop return nothing at all.
- **A fresh worker per solve.** No showdown table is reused between solves on
  the same board, costing ~0.9 s each time on a flop. Terminate-and-respawn is
  the only cancellation that can interrupt an exploitability pass, and the
  saving was not worth a second mechanism.
- **Ten seconds as the default budget.** Right for a river, which is
  the common case and converges inside it. Honest but poor for a flop - see
  below.
- **The exploitability pass always runs.** It costs a minute on a flop, and
  someone who wanted the strategy and not the number pays for it anyway. It is
  cancellable, and the strategy is on screen before it starts.

### One bug found after the browser run

Worth recording because the browser run did not find it and could not have.
The chunk sizer divided `elapsedMs` by `iterations` to get a rate; when the
four-iteration probe finishes inside `Date.now`'s millisecond that rate is
zero, `CHUNK_MS / 0` is `Infinity`, and `solver.run(Infinity)` is a thread that
never returns. Four iterations on a short-stack river tree are about 1.6 ms, so
this is a fast machine away rather than impossible.

The arithmetic moved out of the worker into `nextChunk` in `worker-protocol.ts`
and is tested there, at rates chosen rather than at whatever rate the machine
happened to produce - the rate being the input that decides whether it holds.
Fixed in `49d8d89`, and the app re-driven afterwards.

### What I would check first next

1. **A ten-second flop solve is 416 iterations and 105% exploitable.** The app
   is honest about that - the badge says "indicative only" and the number is
   right there - but a first-time user's first click lands on it. Nothing here
   is wrong; the flop is just expensive. Worth deciding whether the default
   budget should depend on the street, or whether the panel should say what a
   given budget will buy before it is spent rather than after.
2. **Caching the showdown table across solves on the same board** would take
   ~0.9 s off every flop re-solve. It needs a second cancellation mechanism to
   keep a worker alive across solves, which is why it is not here.
3. **The exploitability pass could be made cancellable** by chunking it over
   runouts. It is the one part of the worker that cannot be interrupted except
   by killing the thread.

## Part 2 - the flop number, and what K should default to

### First: the regime the app actually runs in

Added to the plan after building part 3, because part 3 made the gap obvious.
Every sweep on this branch runs to 20,000 or 80,000 iterations. The app's
default budget is ten seconds, and per-iteration cost is flat in K but not
across streets, so ten seconds buys about 16,000 river iterations, 2,100 turn
ones and 420 flop ones - the last measured, not derived, from a browser run
that did 416 in eight seconds. The converged answer is not evidence about the
default.

`bench/app-regime.test.ts`, exact at every depth:

**Turn**, with the 8,000 column from the main diagnostic for continuity:

| iterations | rainbow K=1 | rainbow K=4 | two-tone K=1 | two-tone K=4 |
|---|---|---|---|---|
| 500 | **25.161%** | 27.333% | **26.465%** | 33.802% |
| 1,000 | **18.390%** | 21.252% | **22.155%** | 24.584% |
| 2,000 | **16.217%** | 17.853% | 19.896% | **18.822%** |
| 4,000 | 15.277% | **13.873%** | 18.176% | **15.254%** |
| 8,000 | 14.569% | **12.581%** | 18.169% | **13.492%** |

**Flop**:

| iterations | rainbow K=1 | rainbow K=4 | two-tone K=1 | two-tone K=4 |
|---|---|---|---|---|
| 400 | **57.581%** | 105.054% | **65.656%** | 122.602% |
| 1,600 | **41.673%** | 53.859% | **51.821%** | 60.381% |

### What that shows

**K=4 is a trade against iterations, not against boards.** It is behind when
starved and ahead when converged, and that is true on every board and every
street measured. Nothing here is a case of the class scheme being wrong; it is
the same curve shifted.

**The crossover moves later with each chance node.** On a turn, one chance
node and four-way dilution, K=4 passes K=1 between 1,000 and 2,000 iterations
on the two-tone board and between 2,000 and 4,000 on the rainbow one. On a
flop, two chance levels and sixteen-way dilution, it has not crossed by 1,600
and is still nearly a third behind.

**K=4 is converging much faster where it is behind.** From 400 to 1,600 flop
iterations it drops 49% on the rainbow board and 51% on the two-tone one,
against 28% and 21% for K=1. A curve that steep does cross; the main sweep's
8,000 and 20,000 checkpoints are what say where.

**The app's default budget lands on the wrong side of the turn crossover and
far on the wrong side of the flop one.** Ten seconds is ~2,100 turn iterations
- essentially at the crossover, a coin flip - and ~420 flop iterations, where
K=4 is close to twice as exploitable.

### A cross-check worth recording

The browser did 416 flop iterations at K=4 on `Ks 9h 4c` and reported 105.51%
of pot. This bench, a separate process with no browser in it, did 400 on the
same board and reports 105.054%. Two independent harnesses - one a Web Worker
driving `exploitability()` through the UI, one a node bench calling it
directly - landing within half a point at a matching iteration count. That is
a check on the whole path the displayed number takes, not just on the solver.

### The flop, measured

`bench/flop-decision.test.ts`, seed 12345, `Ks 9h 4c` and `Ks 9s 4c`, 100bb,
10bb pot. Ran 07:47 to 09:51 UTC.

**Exact, not sampled, and both instruments are exact.** `exploitability()`
enumerates the runout inside the walk at every depth and has no sampling path.
`clairvoyantExploitability()` enumerates all 2,352 ordered flop runouts, under
its 4,096 limit, and reported `clairvoyantExact=true` on all sixteen rows. No
estimate appears anywhere below.

Honest exploitability, % of pot, with the 400 and 1,600 rows from the
app-regime bench:

| iterations | rainbow K=1 | rainbow K=4 | two-tone K=1 | two-tone K=4 |
|---|---|---|---|---|
| 400 | **57.581%** | 105.054% | **65.656%** | 122.602% |
| 1,600 | **41.673%** | 53.859% | **51.821%** | 60.381% |
| 2,000 | **40.550%** | 49.213% | **51.383%** | 55.568% |
| 8,000 | 38.367% | **36.932%** | 50.981% | **38.344%** |
| 20,000 | 38.291% | **34.485%** | 50.792% | **34.798%** |
| 80,000 | 38.568% | **33.299%** | 51.473% | **32.862%** |

Per-iteration cost held flat in K across the whole run: 17.8-18.4 ms at both
K=1 and K=4, on 3,957 nodes and on 51,111. Equal iterations is equal wall
clock, so the table is also a fair comparison at fixed time.

**K=1 hits a floor and stops.** 38.4% / 38.3% / 38.6% on the rainbow board at
8k, 20k and 80k; 51.0% / 50.8% / 51.5% on the two-tone one. Ten times the
compute buys nothing at all. That is the abstraction, not the sampling, and it
is the same shape the original K=1 measurement found - correctly, as it turns
out, just at the wrong magnitude.

**K=4 crosses it between 2,000 and 8,000 iterations and keeps going.** It is
still falling at 80,000 (34.485 -> 33.299 rainbow), so it has not converged
where K=1 converged long ago.

**On a two-tone flop the gap is 18.6 points.** 51.473% against 32.862%. This
is the largest effect measured anywhere on the branch.

**And, again, K=1's penalty is a texture penalty.** K=1 reads 38.6% on the
rainbow flop and 51.5% on the two-tone one: 12.9 points worse for nothing but
a suit it cannot see. K=4 reads 33.3% and 32.9% - a difference of 0.4 points.
Classing does not improve an average so much as remove a blindness. Same
finding as the turn, three times the size.

### Why the clairvoyant instrument said the opposite

The clairvoyant column was recorded alongside, and subtracting one from the
other explains the whole original paradox. The gap is the rent clairvoyance
collects - the part of the number that comes from the best response knowing a
card still in the deck:

| | 2,000 | 8,000 | 20,000 | 80,000 |
|---|---|---|---|---|
| rainbow K=1 | 16.80 | 16.57 | 17.01 | 16.97 |
| rainbow K=4 | 24.20 | 23.32 | 23.35 | 23.70 |
| two-tone K=1 | 19.05 | 18.27 | 18.10 | 17.83 |
| two-tone K=4 | 27.80 | 27.86 | 27.71 | 28.34 |

**The rent is flat in iterations and rises with K.** It barely moves across a
forty-fold change in compute - which is what "a floor no strategy can lower"
means - and it is 6.7 points higher at K=4 than K=1 on the rainbow board, 10.5
higher on the two-tone one.

That is not a coincidence, and it is the mechanism: more classes give the
clairvoyant best response *more* to do with its illegal knowledge, because it
can pick a different line in each class subtree knowing which card is coming.
Refining the abstraction raises the rent it collects.

So the instrument the gate was written against charges K=4 a fee for being a
better abstraction, and the fee is the same order as the improvement. On the
rainbow board the honest gain is 5.3 points and the extra rent 6.7, so the
clairvoyant number reads K=4 as *worse*. On the two-tone board the honest gain
is 18.6 and the extra rent 10.5, so even the clairvoyant number reads K=4 as
better - the effect is simply too big to hide.

The original K=8 result falls out of the same arithmetic without needing a
separate explanation.

For continuity: clairvoyant K=1 on a flop at 20,000 iterations is 55.303%,
against the 56.01% published in `TODO.md`. The harness reproduces the old flop
figure as well as the old turn one, so the disagreement was never about the
measurement being run wrong.

## The verdict: `DEFAULT_RUNOUT_CLASSES` stays 4

**No code change.** The brief said to change it if the evidence says so, and
the evidence says keep it. The reasoning, since the verdict alone is not the
useful part:

**1. K=1's cost is permanent and K=4's is temporary.** K=1 is flat from 8,000
to 80,000 iterations on both boards and both streets. Nothing a user can do -
no budget, no faster machine - moves it off 38.6% and 51.5%. K=4 starts worse
and is still improving at 80,000. One of those is a floor and the other is a
queue, and the app now hands the user the control that shortens a queue.

**2. The gain at convergence is large, and largest where it was predicted.**
5.3 points on a rainbow flop, 18.6 on a two-tone one, 2.4 and 5.9 on the
corresponding turns. The ordering - bigger where a flush can complete, bigger
on a flop than a turn - is the mechanism the scheme was designed around
showing up in the measurement, not a number that happened to move.

**3. It removes the texture penalty rather than averaging it away.** K=1 is
12.9 points worse on a two-tone flop than a rainbow one; K=4 is 0.4. A solver
whose error depends on whether the board has a flush draw is wrong in a way
that a user cannot correct for, because it is wrong precisely where they most
need it to be right.

**4. It costs nothing per iteration.** 17.8-18.4 ms at both K on a flop,
across the entire sweep. The trade is 65.1 MiB against 10.3 MiB, which gate 4
already cleared and which a Web Worker holds without noticing.

**5. K=8 remains rejected.** Measured on a turn, where it bought nothing over
K=4, and at 234.6 MiB and 197,171 flop nodes it would face four times K=4's
dilution to earn back a smaller refinement.

### The honest qualification

**Below the crossover K=4 is worse, and the app's default budget is below the
crossover on a flop.** Ten seconds is ~420 flop iterations, where K=4 reads
105% against K=1's 58%. That is a real cost of this decision and it should not
be buried.

It does not change the verdict, for one reason: at 420 iterations *neither* is
a strategy. 58% of pot is not usable and 105% is not usable, the badge calls
both "indicative only", and choosing the default to optimise a regime where
the answer is worthless would be optimising the wrong thing. On a turn, where
ten seconds buys ~2,100 iterations, the two are within a point either way and
twenty seconds puts K=4 clearly ahead.

### The finding underneath all of this

**A flop solve in this app is not usable at any budget a person will wait
for.** 33% of pot after 80,000 iterations - twenty-five minutes of solving
plus a minute of measuring it. That is the best number on this branch and the
badge still reads "indicative only", correctly.

This is not an argument against texture classes; K=4 is the reason it is 33%
and not 51%. It is a statement about where the remaining error lives, and
after tonight it is no longer the runout abstraction that dominates on a
flop - K=4 has taken that from 51% to 33% and is still falling. What is left
is the betting abstraction, the iteration count, or both, and neither was
measured here.

### What I would check first next

1. **Where K=4 actually converges on a flop.** It is still falling at 80,000.
   The number that matters for "is a flop solve ever worth displaying" is the
   asymptote, and nothing here has found it.
2. **Whether the budget should be street-aware.** A river converges in ten
   seconds; a flop needs about a hundred to reach the crossover and far more
   to be useful. I left the default at ten seconds throughout rather than pick
   new numbers, because the measurement says a flop is not usable at any of
   the candidates and a longer default would imply otherwise. This is a design
   decision the brief does not cover and I am flagging rather than making it.
3. **Unreachable classes.** Still open from task A, and now better motivated:
   on a rainbow flop no turn card can be in the flush class, so a quarter of
   the turn subtrees are allocated, never touched, and - the part that matters
   more than the memory - dilute nothing while contributing nothing. Skipping
   them would move the rainbow crossover earlier.
4. **K=6 or a different split.** K=4's win is concentrated in the flush class.
   Nothing here tests whether overcard/brick earns its keep, and dropping a
   class that does not would cut both memory and dilution.
