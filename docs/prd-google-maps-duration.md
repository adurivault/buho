# PRD — Google Maps: "presence" duration (point-to-point model)

## Context / problem

The Google Maps explorer measures duration by **summing each segment's own
duration** (`mins = duration_seconds / 60`, aggregated per zone in the sunburst,
the pies, and the "tracked" indicator). This is wrong: the export contains **two
parallel layers that overlap in time**:

- **Semantic layer** — `visit` (stay, 1 coordinate) + `activity` (movement,
  2 coordinates). They partition time cleanly (8.24 years, ~0 overlap
  between them).
- **Raw GPS layer** — `timelinePath`, **fixed 2 h UTC buckets** (invariant
  verified at 100%) of GPS points, which run **on top of** the visit/activity
  (96% of the path's time falls within a visit/activity).

Summing the two double-counts. Evidence measured on a real export (40,538 entries,
Jul 2016 → Aug 2025, span **9.14 years**):

- current "tracked" = **11.46 years** (vs 8.30 of real coverage). A single
  day shows **27 h out of 24**.
- km also double-counts: `activity.distanceMeters` (347k km) **+**
  haversine of the `timelinePath` (212k) = 559k km.

Also verified (and this is what makes the model sound): the layers **do not
contradict each other**. With correct temporal alignment, a GPS point during a
`visit` is **77 m** from the place (and slow: 4 km/h median), during an `activity` it
speeds along (14 km/h median). Open-source reference: **Dawarich throws away Google's
durations and re-derives everything from the point stream** (a stay's duration = `last − first`
of a cluster).

## Chosen model — "presence" (Idea A)

We treat the base points as **a single merged series sorted by instant**.
A point's duration = **the gap until the next point**, each gap **capped at
24 h**:

```
presenceMins[i] = min( instant[i+1] − instant[i] , 24h )   (last point = 0)
```

**Strong invariant (true at 100%, by construction)**: on a sorted series,
`Σ (t_{i+1} − t_i) = t_last − t_first`. The total **cannot exceed the
span** → double-counting is **structurally impossible**, whatever the
layer overlaps. The cap only subtracts untracked gaps.

Empirical validation of the total by cap:

| cap | total | |
|---|---|---|
| no cap | 9.14 years | = exact span |
| **24 h** | **8.53 years** | ≈ real coverage (8.30) ≈ visit+activity (8.24) ✓ |
| 6 h | 5.62 years | too aggressive (eats nights / long stays) |

Geo attribution: each interval is credited to the **position of its start
point**. During a stay the points are at the place (77 m) → the time falls back to the
right spot; during a trip the time is spread over the real trace.

## Scope

The sunburst/pies measure toggle goes from `tracked | inferred | km | points`
to:

- **time** — `Σ presenceMins` (replaces *both* tracked *and* inferred, which merge).
- **km** — `Σ distanceMeters`, reduced to **a single source**: we **drop the
  haversine distance of the `timelinePath`** at parse time (it was double-counting
  `activity.distanceMeters`). Result = Google's routed distance (~347k km).
- **points** — number of base points (raw density), unchanged.

The toggle affects **all** aggregated visualizations:

- **geo sunburst** and **dimension pies** (already via `measureValue` / `amount`).
- **temporal satellite bars of the constellation** (monthly at the bottom, hourly
  on the side): today as *count*, they switch to the active measure via a
  `barValue` prop on `ConstellationChart` (default `() => 1` → the Spotify explorer,
  which shares the component, stays as count).

The "inferred" indicator in the banner disappears; "tracked" becomes **time**
(presence).

### Out of scope

- The **point cloud** of the constellation keeps the same set of points (all
  segments); only its marginal bars follow the measure.
- We do **not** re-detect stays Dawarich-style (clustering): we stay
  on the provided segments, which is enough for point-to-point presence.
- `geoQueries.ts` (SUM(duration_seconds), today **unused** by the
  explorer) is not modified.

## Implementation

1. **`lib/data/parseGoogleMaps.ts`** — for a `timelinePath` point,
   `distanceMeters: null` (we no longer compute the redundant haversine). visit stays
   `null`, activity keeps `activity.distanceMeters`.
2. **`lib/data/queries/googleMapsQueries.ts`** — field `inferredMins` →
   `presenceMins` on `LocationBasePoint`; `annotateInferredMinutes` →
   `annotatePresenceMinutes`: `presence = min(gap_to_next, 24h)`, last
   point = 0 (sort by instant `x + y·3.6e6`, unchanged).
3. **`routes/google-maps/explore/+page.svelte`** —
   - `Measure = 'time' | 'km' | 'points'`; pills `[ time ] [ km ] [ points ]`.
   - `measureValue`: time → `p.presenceMins`, km → `p.distanceMeters/1000`,
     points → 1.
   - `macroStats`: `totalMinutes = Σ presenceMins`; removal of
     `totalInferredMinutes` and of the "inferred" indicator; banner =
     time / distance / unique places / segments.
   - `barValue` ($derived on `measure`) passed to `ConstellationChart`.
4. **`lib/components/visualizations/ConstellationChart.svelte`** — prop
   `barValue?: (point) => number` (default `() => 1`); the monthly +
   hourly bars sum `barValue(point)` instead of `+1` (count + colored stacks);
   the redraw effect reads `barValue`. Backwards-compatible (Spotify doesn't pass it).

## Verification

- **Unit tests**:
  - `googleMapsQueries.test.ts` (renamed): `annotatePresenceMinutes` — gap < 24 h →
    `presence = gap`; gap > 24 h → 1440; last point → 0; **`Σ presence ≤
    (max instant − min instant)`** (the anti-double-counting invariant); chaining
    correct on unsorted input.
  - `parseGoogleMaps.test.ts`: a `timelinePath` produces points with
    `distanceMeters === null`; `activity` keeps its distance.
- `cd buho-app && npm run check` then `npm test` (full suite).
- `npm run dev` + Timeline export → **visual handoff to Augustin**: check that
  "time" is in the order of magnitude of the span (not 27 h/day), that the toggle
  flips sunburst+pies, and that the distance is no longer doubled.
