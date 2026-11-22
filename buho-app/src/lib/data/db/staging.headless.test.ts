// @vitest-environment node
//
// Headless test of the path every import takes into DuckDB: stage the rows in a
// temp table, merge in the ones the table's natural key doesn't already hold.
//
// Runs `stageAndMerge` itself, with each table's real spec, against the real
// engine (the synchronous Node build of the same wasm core — see
// plays.headless.test.ts). What it guards: that every column lands under its
// own name, and that importing the same rows twice changes nothing.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from './headless.testutil';
import { stageAndMerge, type SqlRunner, type StagedTable } from './staging';
import { PLAYS_TABLE } from './plays';
import { LOCATION_SEGMENTS_TABLE } from './positions';
import { STEP_PACKETS_TABLE } from './steps';
import { HEALTH_READINGS_TABLE } from './health';
import { MESSAGES_TABLE } from './messages';
import { GOOGLE_ACTIVITY_TABLE } from './activity';
import type { Play } from '#lib/types/play.ts';
import type { LocationSegment } from '#lib/types/positions.ts';
import type { StepPacket } from '#lib/types/steps.ts';
import type { HealthReading } from '#lib/types/health.ts';
import type { MessageRow } from '#lib/types/messages.ts';
import type { ActivityRow } from '#lib/types/googleActivity.ts';

let db: HeadlessDuckDB;
let conn: HeadlessConnection;
let runner: SqlRunner;

const rows = (sql: string): Record<string, unknown>[] =>
    conn
        .query(sql)
        .toArray()
        .map((r) =>
            Object.fromEntries(
                Object.entries(r.toJSON()).map(([k, v]) => [
                    k,
                    typeof v === 'bigint' ? Number(v) : v,
                ])
            )
        );

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
    runner = {
        query: (sql) => conn.query(sql),
        registerFileText: (name, text) => db.registerFileText(name, text),
    };
});

afterAll(() => {
    conn?.close();
});

const play: Play = {
    source: 'spotify',
    timestamp: new Date(2024, 4, 1, 10, 0, 0),
    date: new Date(2024, 4, 1),
    msPlayed: 180000,
    trackName: 'Song',
    artistName: 'Artist',
    albumName: 'Album',
    trackUri: 'spotify:track:1',
    isrc: null,
    platform: 'ios',
    platformClean: 'iOS',
    country: 'FR',
    ipAddr: null,
    skipped: false,
    shuffle: null,
    offline: false,
    reasonStart: 'clickrow',
    reasonEnd: 'trackdone',
    episodeName: null,
    episodeShowName: null,
    episodeUri: null,
    incognitoMode: false,
    mediaType: 'track',
};

const segment: LocationSegment = {
    source: 'google-timeline',
    timestamp: '2024-05-01 10:00:00',
    date: '2024-05-01',
    endTimestamp: '2024-05-01 10:30:00',
    durationSeconds: 1800,
    lat: 48.85,
    lon: 2.35,
    segmentType: 'stationary',
    activityType: null,
    semanticType: 'Home',
    placeId: 'abc',
    distanceMeters: null,
    speedKmh: null,
    azimuthDegrees: null,
    altitudeMeters: null,
    heartRate: null,
    cadenceSpm: null,
};

const packet: StepPacket = {
    timestamp: '2024-05-01 10:15:00',
    date: '2024-05-01',
    startTimestamp: '2024-05-01 10:00:00',
    steps: 1200,
    activeSeconds: 600,
    spanSeconds: 900,
    distanceMeters: 950,
    calories: 40,
    cadenceSpm: 120,
    intensity: 2,
    runningSteps: 200,
    runningActiveSeconds: 60,
};

const reading: HealthReading = {
    timestamp: '2024-05-01 10:00:00',
    date: '2024-05-01',
    metric: 'heart_rate',
    value: 72,
};

const message: MessageRow = {
    network: 'whatsapp',
    timestamp: '2024-05-01 10:00:00',
    date: '2024-05-01',
    thread: 'Alex',
    contact: 'Alex',
    isGroup: false,
    sender: 'Alex',
    direction: 'received',
    msgType: 'text',
    mediaKind: 'none',
    text: 'Hello?',
    charCount: 6,
    wordCount: 1,
    emojiCount: 0,
    hasQuestion: true,
    reactionCount: 0,
    reactions: '',
    isUnsent: false,
    gapSeconds: null,
    replyDelaySeconds: null,
    isDoubleText: false,
    sessionId: 1,
    isSessionStart: true,
};

const activity: ActivityRow = {
    timestamp: '2024-05-01 10:00:00',
    date: '2024-05-01',
    service: 'youtube',
    action: 'watched',
    label: 'A video',
    secondary: 'A channel',
    secondaryUrl: null,
    targetId: 'vid1',
    url: 'https://www.youtube.com/watch?v=vid1',
    domain: null,
    origin: null,
    placeLat: null,
    placeLon: null,
    lat: null,
    lon: null,
    locSource: null,
    isAd: false,
};

/** One table under test. Built by `caseOf`, which checks the row against its spec. */
interface Case {
    table: string;
    schema: string;
    /** Stage `copies` identical copies of the row as one drop. */
    stage: (copies: number) => Promise<void>;
    /** A column and the value it must hold after the import. */
    check: [string, unknown];
    /**
     * Whether two identical rows in the *same* drop collapse. `messages` keeps
     * them on purpose (see `messagesDedupeSql`) — pinned here so a change to
     * that is deliberate.
     */
    collapsesTwinsInDrop: boolean;
}

function caseOf<Row>(
    spec: StagedTable<Row>,
    row: Row,
    check: [string, unknown],
    collapsesTwinsInDrop = true
): Case {
    return {
        table: spec.table,
        schema: spec.schema,
        stage: (copies) =>
            stageAndMerge(
                runner,
                spec,
                Array.from({ length: copies }, () => row)
            ),
        check,
        collapsesTwinsInDrop,
    };
}

const CASES: Case[] = [
    caseOf(PLAYS_TABLE, play, ['track_name', 'Song']),
    caseOf(LOCATION_SEGMENTS_TABLE, segment, ['semantic_type', 'Home']),
    caseOf(STEP_PACKETS_TABLE, packet, ['running_steps', 200]),
    caseOf(HEALTH_READINGS_TABLE, reading, ['metric', 'heart_rate']),
    caseOf(MESSAGES_TABLE, message, ['has_question', true], false),
    caseOf(GOOGLE_ACTIVITY_TABLE, activity, ['secondary', 'A channel']),
];

describe.each(CASES)(
    'staging into $table',
    ({ table, schema, stage, check, collapsesTwinsInDrop }) => {
        beforeEach(() => {
            conn.query(`DROP TABLE IF EXISTS ${table}`);
            conn.query(`CREATE TABLE ${table} (${schema})`);
        });

        it('lands every column under its own name', async () => {
            await stage(1);

            const [stored] = rows(`SELECT * FROM ${table}`);
            expect(stored[check[0]]).toBe(check[1]);
            expect(stored.timestamp).not.toBeNull();
        });

        it('keeps one copy of a row imported twice', async () => {
            await stage(1);
            await stage(1);

            expect(rows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n).toBe(1);
        });

        it('handles identical rows within one drop as the table intends', async () => {
            await stage(2);

            const expected = collapsesTwinsInDrop ? 1 : 2;
            expect(rows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n).toBe(expected);
        });

        it('leaves no staging table behind', async () => {
            await stage(1);

            const leftovers = rows(
                `SELECT table_name FROM duckdb_tables() WHERE table_name = '${table}_incoming'`
            );
            expect(leftovers).toHaveLength(0);
        });
    }
);
