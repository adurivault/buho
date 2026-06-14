# Buho — Data Models

**Generated:** 2026-01-31 | **Scan Level:** Deep

## Overview

Buho has no database — all data models represent in-memory TypeScript structures created from user-uploaded files. There are three data domains: Location, WhatsApp, and Spotify.

## Location Data Models

### Core Type: `Segment`

**Source:** `parseLocations.ts:15-29`

The unified representation of a timeline entry from Google Takeout.

```typescript
type Segment = {
  startTime: Date;
  endTime: Date;
  duration: number;            // seconds
  location: { lat: number; lon: number };
  type: "stationary" | "moving";
  // Geographic enrichment (added by enhanceTimeline)
  country?: string;
  departement?: string;
  arrondissement?: string;
  // Metadata
  placeID?: string;            // if stationary (Google Place ID)
  distance?: number;           // if moving (meters)
  activityType?: string;       // "walking", "in passenger vehicle", "timelinePath"
};
```

**Origin mapping:**
| Google Takeout Entry | Segment Type | Location Source | Duration |
|---|---|---|---|
| `visit` | stationary | `topCandidate.placeLocation` | endTime - startTime |
| `activity` | moving | `activity.start` | endTime - startTime |
| `timelinePath[i]` | moving | `point` field | time to next point |

### `BarChartKeyframe`

**Source:** `parseLocations.ts:31-36`

```typescript
type BarChartKeyframe = {
  date: string;            // ISO week (YYYY-WXX)
  regionName: string;
  value: number;           // cumulative hours
  rank: number;            // ranking for this date
};
```

### `HomeCluster`

**Source:** `parseLocations.ts:38-43`

Represents a frequently visited home location (based on 3am positions).

```typescript
type HomeCluster = {
  id: string;                              // "home-0", "home-1", etc.
  centroid: { lat: number; lon: number };
  dayCount: number;
  label: string;                           // e.g., "Paris 11e (Jan 2024 - Dec 2024)"
};
```

### `DailyJourney`

**Source:** `parseLocations.ts:45-58`

A day's movement pattern with coordinates relative to the home cluster centroid.

```typescript
type DailyJourney = {
  date: Date;
  year: number;
  homeLocation: { lat: number; lon: number };  // cluster centroid
  homeClusterId: string;
  path: Array<{
    time: Date;
    location: { lat: number; lon: number };
    relativeX: number;   // km east of home
    relativeY: number;   // km north of home
  }>;
  maxDistance: number;   // km (max distance from home this day)
};
```

### `DailyStats`

**Source:** `parseLocations.ts:60-68`

```typescript
type DailyStats = {
  date: Date;
  totalDuration: number;       // seconds
  stationaryDuration: number;  // seconds
  movingDuration: number;      // seconds
  distance: number;            // meters
  segmentCount: number;
  segments: Segment[];
};
```

## WhatsApp Data Models

### `Message`

**Source:** `parseConversation.ts:4-9`

```typescript
interface Message {
  datetime: Date;
  date: Date;        // day only (midnight)
  sender: string;
  message: string;
}
```

**Parsing format:** `[DD/MM/YYYY HH:MM:SS] Sender: message text`

Multi-line messages are concatenated to the previous message.

## Spotify Data Models

### `SpotifyPlay`

**Source:** `parseSpotify.ts:7-24`

```typescript
interface SpotifyPlay {
  timestamp: Date;
  date: Date;                 // day only (midnight)
  hour: number;               // 0-23
  minute: number;             // 0-59
  msPlayed: number;
  trackName: string | null;
  artistName: string | null;
  albumName: string | null;
  trackUri: string | null;
  platform: string;           // raw platform string
  platformClean: string;      // "macOS" | "iOS" | "Windows" | "Android" | "Web" | "Other"
  country: string;            // connection country code
  skipped: boolean;
  shuffle: boolean;
  offline: boolean;
  reasonStart: string | null;
  reasonEnd: string | null;
}
```

**Platform normalization:** Raw platform strings are cleaned to one of 6 categories via `cleanPlatform()`.

## Data Relationships

```
Google Takeout JSON
        │
        ▼
    Segment[]  ──────────────┐
        │                    │
        ├── getDailyStats() ──→ DailyStats[]
        │                         │
        │                         ├── calculateDailyHomeBases() → Map<date, location>
        │                         │
        │                         ├── calculateDailyTravelRadius() → {date, maxDistance}[]
        │                         │
        │                         └── prepareCalendarData() → {date, dept, distance}[]
        │
        ├── clusterHomeLocations() → HomeCluster[]
        │                                 │
        │                                 ▼
        ├── extractDailyJourneys() → DailyJourney[]
        │
        ├── prepareBarChartRaceData() → BarChartKeyframe[]
        │
        ├── getDurationByRegion() → Map<region, seconds>
        │
        └── aggregateByRegion() → Map<region, {n, duration}>
```

## GeoJSON Reference Data

| File | Feature Count | Key Property | Scope |
|---|---|---|---|
| `countries.geojson` | ~200 | `name` (country name) | World |
| `departements.geojson` | 101 | `nom` (department name) | France |
| `arrondissements.geojson` | 20 | `l_ar` (arrondissement name) | Paris |
