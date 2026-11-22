import { describe, expect, it } from 'vitest';
import { CATALOG_SOURCES, EXPORT_WAIT_ORDER } from '#lib/data/sources/catalog.ts';
import {
    FUNNEL_STEPS,
    queryForStep,
    quickStartSource,
    sourcesByWait,
    sourcesForPhone,
    stepFromUrl,
    stepIndex,
} from './funnel';

const url = (search: string) => new URL(`https://example.test/buho/${search}`);

describe('stepFromUrl', () => {
    it('opens on the intro with no query at all', () => {
        expect(stepFromUrl(url(''))).toEqual({ kind: 'intro' });
    });

    it('reads the picker', () => {
        expect(stepFromUrl(url('?step=pick'))).toEqual({ kind: 'pick' });
    });

    it('reads a known source as the export step', () => {
        const step = stepFromUrl(url('?source=whatsapp'));
        expect(step.kind).toBe('export');
        if (step.kind === 'export') expect(step.source.id).toBe('whatsapp');
    });

    it('reads the drop step', () => {
        expect(stepFromUrl(url('?step=drop'))).toEqual({ kind: 'drop', source: undefined });
    });

    // So Back from the drop step returns to the instructions you were reading,
    // rather than to the top of the funnel.
    it('carries the source through to the drop step', () => {
        const step = stepFromUrl(url('?step=drop&source=whatsapp'));
        expect(step.kind).toBe('drop');
        if (step.kind === 'drop') expect(step.source?.id).toBe('whatsapp');
    });

    // The query string is public surface that gets truncated by chat apps and
    // edited by hand; none of that should be able to break the landing page.
    it('falls back to the intro for anything it has never heard of', () => {
        expect(stepFromUrl(url('?source=myspace'))).toEqual({ kind: 'intro' });
        expect(stepFromUrl(url('?source='))).toEqual({ kind: 'intro' });
        expect(stepFromUrl(url('?step=elsewhere'))).toEqual({ kind: 'intro' });
    });

    it('lets the drop step win over a source, so the shortcut always works', () => {
        expect(stepFromUrl(url('?source=whatsapp&step=drop')).kind).toBe('drop');
    });
});

describe('queryForStep', () => {
    it('leaves the intro on the bare landing page', () => {
        expect(queryForStep({ kind: 'intro' })).toBe('');
    });

    it('round-trips the picker', () => {
        expect(stepFromUrl(url(queryForStep({ kind: 'pick' })))).toEqual({ kind: 'pick' });
    });

    it('round-trips every source through the URL', () => {
        for (const source of CATALOG_SOURCES) {
            const step = { kind: 'export', source } as const;
            const back = stepFromUrl(url(queryForStep(step)));
            expect(back).toEqual(step);
        }
    });

    it('round-trips the drop step, with and without a source', () => {
        expect(stepFromUrl(url(queryForStep({ kind: 'drop' })))).toEqual({
            kind: 'drop',
            source: undefined,
        });

        for (const source of CATALOG_SOURCES) {
            const step = { kind: 'drop', source } as const;
            expect(stepFromUrl(url(queryForStep(step)))).toEqual(step);
        }
    });
});

describe('quickStartSource', () => {
    /**
     * The door and the picker both point at it, and the whole shape of the
     * onboarding — one offer above the fold, everything else below — only holds
     * up if the one being offered costs nothing to try.
     */
    it('is an export you can have without asking anybody', () => {
        expect(quickStartSource().wait).toBe('instant');
        expect(CATALOG_SOURCES).toContain(quickStartSource());
    });
});

describe('sourcesByWait', () => {
    it('leads with the exports you can have in one sitting', () => {
        const ordered = sourcesByWait();
        const instant = ordered.filter((source) => source.wait === 'instant');

        expect(instant.length).toBeGreaterThan(0);
        expect(ordered.slice(0, instant.length)).toEqual(instant);
        expect(instant.map((source) => source.id)).toContain('whatsapp');
    });

    it('ends on the exports you have to request and wait for', () => {
        expect(sourcesByWait().at(-1)?.wait).toBe('days');
    });

    it('is sorted by wait tier throughout', () => {
        const tiers = sourcesByWait().map((source) => EXPORT_WAIT_ORDER.indexOf(source.wait));
        expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    });

    it('keeps catalog order inside a tier, so grouping is the only opinion', () => {
        const ordered = sourcesByWait();
        for (const tier of EXPORT_WAIT_ORDER) {
            const inTier = ordered.filter((source) => source.wait === tier).map((s) => s.id);
            const catalogOrder = CATALOG_SOURCES.filter((s) => s.wait === tier).map((s) => s.id);
            expect(inTier).toEqual(catalogOrder);
        }
    });

    it('lists every source exactly once', () => {
        expect(
            sourcesByWait()
                .map((s) => s.id)
                .sort()
        ).toEqual(CATALOG_SOURCES.map((s) => s.id).sort());
    });

    it('does not reorder the catalog itself', () => {
        const before = CATALOG_SOURCES.map((s) => s.id);
        sourcesByWait();
        expect(CATALOG_SOURCES.map((s) => s.id)).toEqual(before);
    });
});

describe('stepIndex', () => {
    it('places each step on the rail', () => {
        expect(stepIndex({ kind: 'pick' })).toBe(0);
        expect(stepIndex({ kind: 'export', source: CATALOG_SOURCES[0] })).toBe(1);
        expect(stepIndex({ kind: 'drop' })).toBe(2);
    });

    // The intro is the door, not a step you are walked through.
    it('keeps the intro off the rail', () => {
        expect(stepIndex({ kind: 'intro' })).toBe(-1);
    });

    it('covers every rail entry', () => {
        expect(FUNNEL_STEPS).toHaveLength(3);
    });
});

describe('the catalog itself', () => {
    it('gives every source a wait tier', () => {
        for (const source of CATALOG_SOURCES) {
            expect(EXPORT_WAIT_ORDER).toContain(source.wait);
        }
    });
});

describe('sourcesForPhone', () => {
    it('leads with the exports made on the phone itself', () => {
        const ordered = sourcesForPhone();
        const onPhone = ordered.filter((source) => source.madeOnPhone);

        expect(onPhone.map((source) => source.id)).toEqual(
            expect.arrayContaining(['whatsapp', 'google-timeline'])
        );
        expect(ordered.slice(0, onPhone.length)).toEqual(onPhone);
    });

    // Last.fm is instant too, but it is a web tool: it must not jump ahead of
    // an export the visitor can make in the app already in their hand.
    it('puts an instant web export after the phone ones', () => {
        const ids = sourcesForPhone().map((source) => source.id);
        expect(ids.indexOf('lastfm')).toBeGreaterThan(ids.indexOf('whatsapp'));
    });

    it('keeps every source, once', () => {
        const ids = sourcesForPhone().map((source) => source.id);
        expect([...ids].sort()).toEqual(CATALOG_SOURCES.map((source) => source.id).sort());
    });
});
