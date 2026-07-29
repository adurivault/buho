# PRD — Google Maps: "all points" distance

Companion to [`prd-google-maps-duration.md`](./prd-google-maps-duration.md).
Duration answers "how much time"; this doc settles the "how many kilometers" of the
explorer's measure toggle. It also records **what Google does under the hood** with
its distances — the verified mechanics serve to arbitrate this choice *and* future
ones.

All figures come from a real Timeline export (40,538 entries,
Jul 2016 → Aug 2025, span 9.14 years).

## What Google does, mechanically (verified)

**`activity.distanceMeters` = the length of the polyline through the recorded GPS
points, both trip endpoints included.** Reconstructed on our side by joining
`[start] + timelinePath points + [end]` with haversine, we land back on it to
within ~1%, and that holds **for every transport mode**:

| mode | n | chain/dist (median) | dist/chord |
|---|---|---|---|
| in passenger vehicle | 2012 | 1.009 | 1.20 |
| cycling | 1512 | 0.998 | 1.18 |
| walking | 875 | 0.989 | 1.31 |
| in train | 406 | 1.006 | 1.13 |
| in bus | 114 | 0.999 | 1.19 |
| in ferry | 61 | 1.000 | 1.13 |
| in subway | 111 | **1.118** | 1.12 |

Established consequences (and several false intuitions ruled out):

- **It is not great-circle.** `dist/chord` runs 1.13–1.31: the distance follows the
  **real winding route**, not the straight line. The "dist ≈ great-circle on long
  trips" illusion is just a straightness effect (long trips are straighter, so
  chord ≈ route).
- **Nor is it map-matching that adds curvature we don't have.** If it were, we'd see
  `chain < dist`; instead `chain ≈ dist`. Our chain already reaches Google's
  distance.
- **`timelinePath` is a downsample of the same point stream.** Summing the points
  alone (`internal`) undercounts by 5–10% (it cuts corners at both ends); the
  **endpoint legs** (`start`→first point, last point→`end`) make up exactly that
  shortfall → the chain climbs back to 1.00.
- **The only real overcount (jitter) is marginal**: it appears only at inter-point
  spacing < 100 m (55 trips, +7–19%). Negligible.

**Durable mental model**: `visit` / `activity` / `timelinePath` are **three views of
a single stream of time-stamped positions**. `distanceMeters` is that stream's
precomputed scalar at full resolution; the export's `timelinePath` is a lighter
subsample of it. Any future geometric question (distance, speed, stops) is reasoned
over this one stream.

## Where the sources diverge (also verified)

1. **Underground** (subway: chain/dist 1.12) — GPS lost below ground, our
   reconstruction inflates; `distanceMeters` (likely schedule-derived) is more
   reliable. ~111 trips.
2. **Bundled long journeys** — Google sometimes merges a multi-leg journey into a
   single `activity` whose `start`/`end`/`distanceMeters` describe only **one
   sub-leg**. E.g. a ~660 km Marseille→Paris trip reported as 23 km. **145 trips
   (1.1%), ~12,700 km hidden** — exactly the memorable journeys. Here only the
   `timelinePath` tells the truth.
3. **`visit` is NOT a reliable move/stop mask.** Of the 45,000 km of GPS points
   falling inside a `visit` window:
   - **confident** visits (`Home`, `Work`, `Inferred Home`, `Aliased`) are clean:
     ~3.4k km, < 5–8% stray from the place → genuine stationary time.
   - **`Unknown`** carries 41.7k km (92%), of which **35% roam ≥1 km** from the
     place: this is **real movement Google failed to classify** (200–500 km trips
     swallowed inside `Unknown` "visits").

   → The move/stop boundary is not in the `visit` label but in the points
   themselves (displacement / speed). `distanceMeters` alone **loses** these trapped
   trips; a raw point sum **keeps** them.

## Decision

**A point's distance = haversine to the next point in the merged, instant-sorted
series. We keep all points, no mask.**

Exact parallel of the presence model (duration = gap to the next point). We do
**not** rely on `activity.distanceMeters` or on Google's visit/activity
segmentation.

Why this choice:

- **Simple and intelligible**: "sum of distances between consecutive positions."
  One rule, the same as for duration.
- **Label-independent**: sidesteps the unreliable `Unknown` segmentation and
  naturally recovers the truncated long journeys.
- **The gap is intentional and rather healthy**: the `timelinePath`'s low
  resolution tends to *reduce* distance (it cuts corners); keeping the stationary
  jitter and the gap reconstructions pulls the other way.

### What it yields, quantified (and honest)

| | km | vs dist |
|---|---|---|
| Σ `activity.distanceMeters` (semantic ref) | 347,494 | 1.00× |
| **all-points chain (haversine to next)** | **418,513** | **1.20×** |
| — of which legs < 2 h (continuous tracking) | 307,574 | 74% |
| — of which legs 2–24 h (gap reconstruction) | 103,963 | 25% |
| — of which legs > 24 h | 6,976 | 2% |

The total exceeds the semantic distance by **~20%**. Two assumed contributions: the
**stationary jitter** (~45k km of GPS tremor during stays) and the **straight-line
reconstruction over sparsely-tracked periods** (the 2–24 h legs). Since a straight
line is a lower bound on the true distance, this surplus stays defensible for a
"consumer" metric; we accept it for the sake of simplicity.

## Implementation

1. **`lib/data/queries/googleMapsQueries.ts`**
   - Add `legMeters: number` to `LocationBasePoint` (initialized `0` in the mapper,
     like `presenceMins`).
   - New function `annotateLegMeters(points)`, **twin of
     `annotatePresenceMinutes`**: same `instantMs` sort, then
     `p.legMeters = haversine(p, next)` (lat/lon live in `p.metadata`), last
     point = 0. Call it alongside `annotatePresenceMinutes` in
     `getGoogleMapsExplorerBasePoints`.
   - (Optional, parallel to the presence cap) skip drawing a leg when the time gap
     > 24 h; removes only 1.7%.
2. **`routes/google-maps/explore/+page.svelte`** — in `measureOf`, the `km` measure
   reads `p.legMeters / 1000` (instead of `p.distanceMeters / 1000`). The toggle,
   sunburst, pies and the constellation's satellite bars already go through
   `measureValue` → nothing else to change.
3. **`lib/data/parseGoogleMaps.ts`** — the per-segment `distance_meters` and the
   `inActivity`/haversine guard (the half-rebuilt "mix" state) no longer feed the
   explorer's km measure. To simplify: distance is now computed from the point
   chain, not at parse time. *(Note: that mix was leaking the ~45k km of jitter via
   the non-activity points — it goes away with this change.)* Check that no other
   consumer of `distance_meters` (e.g. `geoQueries.ts`) breaks before removing it.

## Out of scope / assumed caveats

- **No motion-gating**: we do not re-detect stops Dawarich-style (speed threshold).
  A simplicity choice; the stationary jitter is kept on purpose as a counterweight
  to the `timelinePath` undercount.
- **Underground and truncated journeys**: not specifically corrected; the
  all-points chain covers them "well enough" (it recovers the truncated ones,
  slightly inflates the subway).
- The **duration** measure (`presenceMins`) is untouched — it uses only timestamps,
  which stay correct.

## Verification

- **Unit test** `googleMapsQueries.test.ts`: `annotateLegMeters` — correct haversine
  between two points; last point = 0; chaining over an instant-unsorted series; a
  lone point → 0.
- `cd buho-app && npm run check` then `npm test`.
- `npm run dev` + a Timeline export → **visual handoff to Augustin**: the `km`
  toggle re-drives sunburst + pies + bars; the total's order of magnitude is sane
  (~1.2× the `distanceMeters` sum, not an absurd factor).
