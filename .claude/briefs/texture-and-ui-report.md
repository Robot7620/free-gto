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

<!-- PENDING -->

## Gates

| gate | verdict |
|---|---|
| 1. `npm test` green, `npm run build` clean | **Passed** - 84 tests in 12 files, 40.2 s; `tsc` clean, `vite build` in 709 ms |
| 2. River unchanged | **Passed**, in the sharpest form available |
| 3. Turn and flop measurably improve | <!-- PENDING --> |
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
