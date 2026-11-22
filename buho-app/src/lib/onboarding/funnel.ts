import type { ReadonlyURL } from '$app/state';
import {
    CATALOG_SOURCES,
    EXPORT_WAIT_ORDER,
    type CatalogSource,
} from '#lib/data/sources/catalog.ts';

/**
 * The onboarding funnel: pick an export, go and get it, drop it in.
 *
 * The three steps are a reading order, not a gate. Routing is per file — the
 * importer sniffs what it is handed and nobody ever declares a source — so
 * picking "WhatsApp" here changes which instructions are shown and nothing else.
 * A drop on any step, from the window-wide zone or the one in step three, lands
 * exactly the same way. That is what lets the funnel be thorough for someone who
 * has never seen an export without standing in the way of someone who already
 * has one on their desktop.
 *
 * State lives in the URL rather than in a component, so a step can be linked to
 * ("start here: /?source=whatsapp"), Back walks the funnel backwards, and there
 * is nothing to persist — which there could not be anyway, since Buho stores
 * nothing between page loads.
 */

export type FunnelStep =
    /**
     * What this is, before any of it is asked of you.
     *
     * Not a step you do — the door. It exists because the picker, arrived at
     * cold, is a wall of services and waiting times with no answer to "what is
     * this thing?". Ask, drop, look: three sentences, then the funnel.
     */
    | { kind: 'intro' }
    /** Which of your data do you want to look at? */
    | { kind: 'pick' }
    /** How to get that one out of the service that holds it. */
    | { kind: 'export'; source: CatalogSource }
    /**
     * Hand it over. Carries the source you came through, when there was one, so
     * Back returns to the instructions you were reading rather than dumping you
     * at the top of the funnel. Absent for anyone who skipped straight here.
     */
    | { kind: 'drop'; source?: CatalogSource };

export type FunnelStepKind = FunnelStep['kind'];

/** The steps that appear on the rail. The intro is not one of them. */
export type RailKind = Exclude<FunnelStepKind, 'intro'>;

/** The rail across the top, in order. */
export const FUNNEL_STEPS: Array<{ kind: RailKind; label: string }> = [
    { kind: 'pick', label: 'Pick your data' },
    { kind: 'export', label: 'Get the file' },
    { kind: 'drop', label: 'Drop it in' },
];

/** Where a step sits on the rail, or -1 for the intro, which is not on it. */
export function stepIndex(step: FunnelStep): number {
    return FUNNEL_STEPS.findIndex((entry) => entry.kind === step.kind);
}

/**
 * Which step a URL is asking for.
 *
 * Total, and deliberately forgiving: the query string is public surface that
 * people edit, shorten and mangle in chat apps, and the honest answer to a
 * `?source=` naming an export Buho has never heard of is the picker — not a 404
 * and not a crash.
 */
export function stepFromUrl(url: ReadonlyURL): FunnelStep {
    const id = url.searchParams.get('source');
    const source = id ? CATALOG_SOURCES.find((candidate) => candidate.id === id) : undefined;
    const step = url.searchParams.get('step');

    if (step === 'drop') return { kind: 'drop', source };
    if (source) return { kind: 'export', source };
    if (step === 'pick') return { kind: 'pick' };

    return { kind: 'intro' };
}

/**
 * The query string that names a step, ready to append to a resolved `/`.
 *
 * Empty for the intro: the address people are given is the bare landing page,
 * with nothing in it to mangle or lose.
 */
export function queryForStep(step: FunnelStep): string {
    switch (step.kind) {
        case 'intro':
            return '';
        case 'pick':
            return '?step=pick';
        case 'export':
            return `?source=${encodeURIComponent(step.source.id)}`;
        case 'drop':
            return step.source
                ? `?step=drop&source=${encodeURIComponent(step.source.id)}`
                : '?step=drop';
    }
}

/**
 * Every export, soonest to arrive first.
 *
 * The order is the whole point of the first step. Left in catalog order, the
 * list opens on Spotify, which takes up to a month to send anything — a fine
 * default for a reference table and a bad one for somebody deciding, right now,
 * whether this app is worth the trouble. Within a tier the catalog's own order
 * stands, so the grouping is the only opinion being expressed.
 */
export function sourcesByWait(): CatalogSource[] {
    return [...CATALOG_SOURCES].sort(
        (a, b) => EXPORT_WAIT_ORDER.indexOf(a.wait) - EXPORT_WAIT_ORDER.indexOf(b.wait)
    );
}

/**
 * The same list, for somebody holding a phone.
 *
 * The exports made inside the phone's own apps come first, whatever their tier:
 * Last.fm is as instant as WhatsApp, but it is a web tool that wants a computer,
 * while a WhatsApp chat can be exported from the device already in your hand.
 * After those, the soonest to arrive — the ones worth asking for today, so the
 * file is waiting by the time you sit down at a computer.
 */
export function sourcesForPhone(): CatalogSource[] {
    const byWait = sourcesByWait();
    return [
        ...byWait.filter((source) => source.madeOnPhone),
        ...byWait.filter((source) => !source.madeOnPhone),
    ];
}

/**
 * The one export the funnel leads with.
 *
 * Everything else is a service you have to ask, and the answer comes back hours
 * or days later — which is a fine thing to sign up for and a terrible thing to
 * put in front of somebody who has not yet seen Buho do anything. The WhatsApp
 * export is a button inside the app: two minutes end to end, no account, no
 * queue. That is the only export that can carry a first visit.
 *
 * Named here rather than inlined in the door and the picker, because both point
 * at it and they must not disagree.
 */
export function quickStartSource(): CatalogSource {
    const source = CATALOG_SOURCES.find((candidate) => candidate.id === 'whatsapp');
    if (!source) throw new Error('The funnel leads with WhatsApp, which the catalog no longer has');
    return source;
}

/**
 * What people call this service, where the catalog uses its formal name.
 *
 * Scoped to the funnel on purpose. `catalog.ts` is a reference and is right to
 * say "Google Timeline" — that is the export's name, it is what the setting is
 * called on the phone, and the /sources page is read by somebody who has already
 * decided to go looking. The funnel is read by somebody deciding whether to
 * bother, in about two seconds, and "Google Timeline" costs them one of those
 * seconds working out that it means their Maps history.
 */
const FUNNEL_NAMES: Record<string, string> = {
    'google-timeline': 'Google Maps',
};

/** The source's name as the funnel says it. */
export function funnelLabel(source: CatalogSource): string {
    return FUNNEL_NAMES[source.id] ?? source.label;
}
