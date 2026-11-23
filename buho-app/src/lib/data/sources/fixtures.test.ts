// Keeps the fixtures honest: each one must be claimed by its own parser and
// yield rows. A fixture that drifted from its format would otherwise keep
// passing every test that uses it, silently testing nothing.
//
// Default (jsdom) environment on purpose: the GPX/TCX reader uses the
// browser's DOMParser, as it does in the app.
import { describe, it, expect } from 'vitest';
import { readDrop, routeEntries } from './registry';
import { FIXTURE_SOURCES, fixtureEntries, type FixtureSource } from './fixtures.testutil';

const EXPECTED: Record<FixtureSource, { parser: string; dataset: keyof Rows }> = {
    spotify: { parser: 'spotify-json', dataset: 'plays' },
    lastfm: { parser: 'lastfm-json', dataset: 'plays' },
    googleTimeline: { parser: 'google-timeline', dataset: 'positions' },
    googleActivity: { parser: 'google-activity', dataset: 'activity' },
    metaJson: { parser: 'meta-json', dataset: 'threads' },
    normalizedJson: { parser: 'normalized-json', dataset: 'threads' },
    whatsappText: { parser: 'whatsapp-text', dataset: 'threads' },
    strava: { parser: 'strava', dataset: 'positions' },
    appleHealth: { parser: 'apple-health', dataset: 'steps' },
};

type Rows = Pick<
    Awaited<ReturnType<typeof readDrop>>,
    'plays' | 'positions' | 'activity' | 'threads' | 'steps'
>;

describe.each(FIXTURE_SOURCES)('fixture: %s', (source) => {
    const { parser, dataset } = EXPECTED[source];

    it(`is claimed by ${parser}`, async () => {
        const { matched, unmatched } = await routeEntries(fixtureEntries(source));
        expect(unmatched).toEqual([]);
        expect([...matched.keys()].map((p) => p.id)).toEqual([parser]);
    });

    it(`yields ${dataset}`, async () => {
        const drop = await readDrop(fixtureEntries(source));
        expect(drop.failedParsers).toEqual([]);
        expect(drop[dataset].length).toBeGreaterThan(0);
    });
});
