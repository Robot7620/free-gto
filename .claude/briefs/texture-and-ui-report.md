# Report: runout texture classes, and the UI that did not get built

Branch `texture-classes`, cut from `phase-4` at `81d77b2`. Pushed.

**Task A landed. Task B was not started.** The sequencing in the brief was right:
A took the session. What B needs to know from A is at the bottom.

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
| 1. `npm test` green, `npm run build` clean | <!-- PENDING --> |
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

## For whoever picks up Task B

Nothing of B was built. What A establishes that B needs:

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
