<script lang="ts">
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import ExplorerIndicators, {
        type Indicator,
    } from '#lib/components/visualizations/ExplorerIndicators.svelte';
    import ClearFiltersButton from '#lib/components/visualizations/ClearFiltersButton.svelte';
    import { peakColor } from '#lib/visualizations/themeColors.ts';
    import { onDestroy, untrack } from 'svelte';
    import ConstellationChart from '#lib/components/visualizations/ConstellationChart.svelte';
    import ContactRankingPanel, {
        type ContactRankRow,
    } from '#lib/components/visualizations/ContactRankingPanel.svelte';
    import ConversationReader, {
        type ReaderMessage,
    } from '#lib/components/visualizations/ConversationReader.svelte';
    import DimensionPie from '#lib/components/visualizations/DimensionPie.svelte';
    import MeasureToggle, {
        type MeasureOption,
    } from '#lib/components/visualizations/MeasureToggle.svelte';
    import LoadingOverlay from '#lib/components/LoadingOverlay.svelte';
    import ModuleEmptyState from '#lib/components/ModuleEmptyState.svelte';
    import { moduleById } from '#lib/data/modules.ts';
    import {
        getMessageBasePoints,
        getMessageTimeDomain,
        type MessageBasePoint,
    } from '#lib/data/queries/messageQueries.ts';
    import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
    import type { FilterOrigin, FilterState } from '#lib/types/filters.ts';
    import {
        dowLabel,
        inWindow,
        markMatched,
        passesAll,
        topNSlices,
        valueTests,
        type CrossfilterTest,
        type ValueDimension,
        type DimensionSlice,
    } from '#lib/explorer/crossfilter.ts';
    import {
        PointSearch,
        SEARCH_KEY,
        TERM_COLOR_KEY,
        followSearch,
        initialColoring,
        isWordless,
        parseSearch,
        searchQuery,
        termFor,
        toggleColoring,
        toggleTerm,
        withoutTerm,
        type TermColoring,
    } from '#lib/explorer/search.ts';
    import ExplorerSearch from '#lib/components/visualizations/ExplorerSearch.svelte';
    import SearchLegend from '#lib/components/visualizations/SearchLegend.svelte';
    import MessageSearchResults, {
        type MessageHit,
    } from '#lib/components/visualizations/MessageSearchResults.svelte';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { messagesExplorerFilters } from '#lib/stores/messagesExplorerFilters.svelte.ts';
    import { stickyColor, termColor } from '#lib/utils/dimensionColors.ts';
    import { trackControl } from '#lib/analytics.ts';
    import { firstFilterValue } from '#lib/utils/filters.ts';
    import { tallyEmojis, type EmojiCount } from '#lib/utils/emoji.ts';
    import EmojiTally from '#lib/components/visualizations/EmojiTally.svelte';

    // Resolved at render time: the constellation paints on a canvas, which
    // cannot read the module's `--peak-*` itself. Its points are dots, too small
    // for the module's pastel fill.
    const MATCHED_COLOR = $derived.by(() => {
        void themeStore.theme;
        return peakColor('messages');
    });

    // The points are loaded ONCE (raw: no reactive proxy over the whole export).
    // The `matched` flag is recomputed in JS in place, and `matchVersion` triggers
    // a chart-side redraw without rebuilding the quadtree or hitting the DB.
    let basePoints = $state.raw<MessageBasePoint[]>([]);
    let matchVersion = $state(0);
    let pieSlices = $state<Record<string, DimensionSlice[]>>({});
    let contactRows = $state<ContactRankRow[]>([]);
    /** Totals for the current selection, shown above the charts. */
    let tiles = $state({ messages: 0, words: 0, chars: 0 });
    /** The emoji most typed in the current selection. */
    let emojiTally = $state<EmojiCount[]>([]);

    /** How many emoji the strip has room for on one line. */
    const TALLY_EMOJIS = 10;

    let initialLoad = $state(true);
    let containerWidth = $state(0);
    let containerHeight = $state(0);
    let viewportHeight = $state(0);
    let timeDomain = $state<[number, number] | null>(null);
    let viewTimeDomain = $state.raw<[number, number] | null>(null);
    let viewHourDomain = $state.raw<[number, number] | null>(null);

    // The pies take ~10% of the screen height (square + label). Clamped to stay
    // legible on small screens and reasonable on large ones.
    const pieSize = $derived(Math.max(56, Math.min(120, Math.round(viewportHeight * 0.1) - 20)));

    const module = moduleById('messages');
    const activeFilters = $derived(messagesExplorerFilters.activeFilters);
    const dbReady = $derived(dataStore.loaded.messages && !dataStore.isLoading);

    // The `timestamp` column is stored as LOCAL wall-clock time (cf.
    // import/buildRows). The "YYYY-MM-DD HH:MM:SS" format has no zone suffix:
    // new Date() already interprets it as local time.
    function formatSentAt(sentAt: string): string {
        const d = new Date(sentAt.replace(' ', 'T'));
        return Number.isNaN(d.getTime()) ? sentAt : d.toLocaleString();
    }

    /** Message text is the point of the tooltip, but a whole paragraph isn't. */
    function truncate(text: string, max = 120): string {
        const clean = text.replace(/\s+/g, ' ').trim();
        return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
    }

    function constellationTooltip(m: Record<string, unknown>) {
        const text = truncate((m.text as string) ?? '');
        const reactions = (m.reactions as string) ?? '';
        // Title is the conversation, first line is who wrote it. In a group the
        // sender can't be guessed from the direction, and even one-to-one it is
        // what you actually want to read first.
        const lines = [`${m.sender} · ${m.network} · ${formatSentAt(m.sentAt as string)}`];
        if (text) lines.push(text);
        else if (m.mediaKind !== 'none') lines.push(`[${m.mediaKind}]`);
        if (reactions) lines.push(reactions.split(',').join(' '));
        return { title: m.contact as string, lines };
    }

    // --- Dimensions (config) ---------------------------------------------
    // `key` = store key; `field` = field carried by the base points. All of them
    // affect the constellation's `matched`; `contact` drives the ranking panel
    // rather than a pie, so it is not in PIE_DIMS.
    type MatchDim = ValueDimension<MessageBasePoint>;
    const CONTACT_DIM: MatchDim = { key: 'contact', field: 'fContact' };
    const MATCH_DIMS: MatchDim[] = [
        CONTACT_DIM,
        { key: 'network', field: 'fNetwork' },
        { key: 'direction', field: 'fDirection' },
        { key: 'msg_type', field: 'fType' },
        { key: 'media_kind', field: 'fMediaKind' },
        { key: 'reacted', field: 'fReacted' },
        { key: 'length_bucket', field: 'fLength' },
        { key: 'dayofweek', field: 'dow' },
        { key: 'year', field: 'year' },
    ];

    interface PieDim extends MatchDim {
        label: string;
        format?: (v: string) => string;
    }
    const PIE_DIMS: PieDim[] = [
        { key: 'network', field: 'fNetwork', label: 'Network' },
        { key: 'direction', field: 'fDirection', label: 'Direction' },
        { key: 'msg_type', field: 'fType', label: 'Type' },
        { key: 'media_kind', field: 'fMediaKind', label: 'Attachment' },
        { key: 'reacted', field: 'fReacted', label: 'Reactions' },
        { key: 'length_bucket', field: 'fLength', label: 'Length' },
        {
            key: 'dayofweek',
            field: 'dow',
            label: 'Day of week',
            format: dowLabel,
        },
        { key: 'year', field: 'year', label: 'Year' },
    ];

    /**
     * Dimensions the ranking ignores. Its own, like every breakdown — plus
     * `direction`: the panel draws both sides of each conversation, so filtering
     * one side would flatten every row against an empty wing.
     */
    const RANKING_EXEMPT = new Set<string>([CONTACT_DIM.key, 'direction']);

    // --- Search -----------------------------------------------------------
    // The query sits in the filter store with the other selections, so it
    // narrows every view the way a pie click does and "Clear all filters"
    // clears it too. Matching runs over the text the points already carry.

    const searchRaw = $derived(searchQuery(activeFilters));
    const searchTerms = $derived(parseSearch(searchRaw));
    const searching = $derived(searchTerms.length > 0);
    /** Each term's color, in query order: the marks, the legend, the constellation. */
    const termColors = $derived(searchTerms.map((_, i) => termColor(i)));

    const search = new PointSearch<MessageBasePoint>((p) => (p.metadata.text as string) ?? '');
    /** Hits per term in the current selection, for the legend. */
    let termCounts = $state<number[]>([]);

    function setSearch(raw: string, origin: FilterOrigin = 'search') {
        if (raw.trim()) messagesExplorerFilters.setFilter(SEARCH_KEY, raw, origin);
        else messagesExplorerFilters.removeFilter(SEARCH_KEY, origin);
    }

    /**
     * An emoji in the tally is a search waiting to happen: clicking one adds it
     * as a term — beside any typed ones, so two emoji compare like two words —
     * and clicking it again takes it back out. It matches wherever the emoji is
     * typed, skin tones and combined forms included.
     */
    function toggleEmoji(emoji: string) {
        setSearch(toggleTerm(searchRaw, emoji), 'emoji');
    }

    function emojiTermColor(emoji: string): string | null {
        const index = termFor(searchTerms, emoji);
        return index === -1 ? null : termColors[index];
    }

    const searchLegend = $derived(
        searchTerms.map((term, i) => ({
            label: term.label,
            count: termCounts[i] ?? 0,
            color: termColors[i],
        }))
    );

    // --- Measure ----------------------------------------------------------
    // What every figure counts. Messages is the default; words and characters
    // re-weight the same points towards how much was actually written, which
    // tells a different story for someone who sends essays vs one-liners.
    type Measure = 'messages' | 'words' | 'chars';
    let measure = $state<Measure>('messages');

    const MEASURES: MeasureOption[] = [
        { key: 'messages', label: 'Messages', hint: 'One unit per message' },
        { key: 'words', label: 'Words', hint: 'Weighted by words written' },
        { key: 'chars', label: 'Characters', hint: 'Weighted by characters typed' },
    ];

    function measureOf(m: Measure, p: MessageBasePoint): number {
        if (m === 'words') return p.words;
        if (m === 'chars') return p.chars;
        return 1;
    }

    const measureValue = (p: MessageBasePoint) => measureOf(measure, p);

    // A fresh closure per measure change, so the satellite bars recompute.
    const barValue = $derived.by(() => {
        const m = measure;
        return (p: ConnectablePoint) => measureOf(m, p as MessageBasePoint);
    });

    const measureLabel = $derived(
        measure === 'messages' ? 'messages' : measure === 'words' ? 'words' : 'characters'
    );

    // --- Reading pane -----------------------------------------------------
    // Selecting a conversation opens it for reading, under the ranking. It is a
    // detail view, not another breakdown: it shows the messages the filters
    // already selected, and takes part in no aggregation of its own.

    /** Rendering a 20k-message thread as bubbles at once would stall the page, so
     *  the reader opens on the last page and walks back a page at a time. */
    const READER_PAGE = 1000;
    /** Messages shown after one the reader was opened on, before "Load later". */
    const READER_AFTER = 150;
    let readerBefore = $state(READER_PAGE);
    let readerAfter = $state(READER_AFTER);
    /**
     * The message the reader is opened on, when it is not simply the end of the
     * thread: a search result that was clicked, or a match stepped to.
     */
    let readerFocus = $state<number | null>(null);
    /** Set by a click on a result, for the contact change it triggers to pick up. */
    let pendingFocus: number | null = null;

    const selectedContact = $derived(firstFilterValue(activeFilters, 'contact'));

    // A different conversation starts at its own end, not where the last one had
    // been unrolled to — unless it was opened on a particular message.
    let lastReaderContact: string | null = null;
    $effect(() => {
        const contact = selectedContact;
        if (contact === lastReaderContact) return;
        lastReaderContact = contact;
        readerBefore = READER_PAGE;
        readerAfter = READER_AFTER;
        readerFocus = pendingFocus;
        pendingFocus = null;
    });

    function focusMessage(id: number) {
        readerFocus = id;
        readerBefore = READER_PAGE;
        readerAfter = READER_AFTER;
    }

    /** A search result opens its conversation — the list only shows while none is. */
    function openHit(hit: MessageHit) {
        trackControl('messages-explorer', 'search-result', 'open');
        pendingFocus = hit.id;
        messagesExplorerFilters.setFilter('contact', hit.contact, 'search');
    }

    const readerData = $derived.by(() => {
        const contact = selectedContact;
        // `matched` is mutated in place, so the version is what marks it stale.
        void matchVersion;
        const empty = {
            messages: [] as ReaderMessage[],
            total: 0,
            later: 0,
            isGroup: false,
            hits: [] as number[],
            focus: null as number | null,
        };
        if (!contact) return empty;

        // With a search on, the reader shows the conversation *around* its
        // matches rather than the matches alone: a hit read out of context is
        // rarely the whole story. So the search is the one filter it leaves out
        // — it marks the matches and steps through them instead.
        const tests = searching
            ? filterTests(activeFilters).filter((test) => test.key !== SEARCH_KEY)
            : [];
        const window = { time: viewTimeDomain, hour: viewHourDomain };
        const thread: MessageBasePoint[] = [];
        let isGroup = false;
        for (const p of basePoints) {
            if (p.fContact !== contact || !inWindow(p, window)) continue;
            // Without a search, `matched` already carries the contact filter plus
            // every other active dimension.
            if (searching ? !passesAll(p, tests) : !p.matched) continue;
            thread.push(p);
            if (p.isGroup) isGroup = true;
        }

        // The query orders by day, not by instant, so the reader sorts before it
        // can claim to be chronological.
        thread.sort((a, b) => {
            const sa = a.metadata.sentAt as string;
            const sb = b.metadata.sentAt as string;
            return sa < sb ? -1 : sa > sb ? 1 : a.msgIndex - b.msgIndex;
        });

        const hits = searching
            ? thread.filter((p) => p.searchTerm !== '').map((p) => p.msgIndex)
            : [];

        // Opened from the ranking during a search, a thread opens on its latest
        // match; a focus the filters have since excluded falls back the same way.
        let at = readerFocus === null ? -1 : thread.findIndex((p) => p.msgIndex === readerFocus);
        if (at === -1 && hits.length) {
            const last = hits[hits.length - 1];
            at = thread.findIndex((p) => p.msgIndex === last);
        }

        const start = Math.max(0, (at === -1 ? thread.length : at) - readerBefore);
        const end = at === -1 ? thread.length : Math.min(thread.length, at + 1 + readerAfter);

        const messages = thread.slice(start, end).map((p) => ({
            id: p.msgIndex,
            sentAt: p.metadata.sentAt as string,
            sender: p.fSender,
            direction: p.fDirection,
            text: (p.metadata.text as string) ?? '',
            mediaKind: p.fMediaKind,
            reactions: (p.metadata.reactions as string) ?? '',
        }));

        return {
            messages,
            total: thread.length,
            later: thread.length - end,
            isGroup,
            hits,
            focus: at === -1 ? null : thread[at].msgIndex,
        };
    });

    // --- Search results ---------------------------------------------------
    // While a search runs and no conversation is open, the right column lists
    // the matches themselves, newest first.

    const RESULTS_PAGE = 100;
    let resultsLimit = $state(RESULTS_PAGE);

    // A new query starts the list from the top again.
    $effect(() => {
        void searchRaw;
        resultsLimit = RESULTS_PAGE;
    });

    const searchResults = $derived.by(() => {
        void matchVersion;
        if (!searching || selectedContact) return { hits: [] as MessageHit[], total: 0 };

        const window = { time: viewTimeDomain, hour: viewHourDomain };
        const limit = resultsLimit;
        const picked: MessageBasePoint[] = [];
        let total = 0;
        // The points are ordered by day, so walking back from the end meets the
        // newest days first; the last day reached is taken whole and the pick is
        // sorted by instant, since within a day the order is arbitrary.
        for (let i = basePoints.length - 1; i >= 0; i--) {
            const p = basePoints[i];
            if (!p.matched || !inWindow(p, window)) continue;
            total += 1;
            if (picked.length < limit || p.x === picked[picked.length - 1].x) picked.push(p);
        }
        picked.sort((a, b) => {
            const sa = a.metadata.sentAt as string;
            const sb = b.metadata.sentAt as string;
            return sa < sb ? 1 : sa > sb ? -1 : b.msgIndex - a.msgIndex;
        });

        const hits = picked.slice(0, limit).map((p) => ({
            id: p.msgIndex,
            sentAt: p.metadata.sentAt as string,
            contact: p.fContact,
            sender: p.fSender,
            direction: p.fDirection,
            isGroup: p.isGroup,
            text: (p.metadata.text as string) ?? '',
        }));
        return { hits, total };
    });

    const TOP_N = 15;
    /** Contacts listed in the ranking panel — enough to scroll, not to drown. */
    const CONTACT_LIMIT = 60;

    // --- Coloring by dimension -------------------------------------------
    // `colorBy` = store key of the dimension that colors the constellation and
    // stacks the satellite barcharts (null = the Messages accent by default), or
    // the search's terms — see `followSearch` for when a search takes over.
    let coloring = $state<TermColoring>(initialColoring(null));
    const colorBy = $derived(coloring.colorBy);

    const colorByTerm = $derived(colorBy === TERM_COLOR_KEY && searching);

    const colorByDim = $derived(colorBy ? (PIE_DIMS.find((d) => d.key === colorBy) ?? null) : null);

    /** The field the constellation paints by: a pie's dimension, or the matched term. */
    const colorField = $derived(colorByTerm ? 'searchTerm' : (colorByDim?.field ?? null));

    const colorCategories = $derived(
        colorByTerm
            ? searchTerms.map((term, i) => ({ value: term.label, color: termColors[i] }))
            : colorBy && colorByDim
              ? (pieSlices[colorBy] ?? []).map((s) => ({
                    value: s.value,
                    color: stickyColor(colorBy as string, s.value),
                }))
              : []
    );

    function toggleColorBy(key: string) {
        coloring = toggleColoring(coloring, key);
    }

    $effect(() => {
        const count = searchTerms.length;
        untrack(() => (coloring = followSearch(coloring, count)));
    });

    /**
     * Currently filtered dimensions + their Set of values, and the search once
     * the points are marked for it.
     */
    function filterTests(f: FilterState): CrossfilterTest<MessageBasePoint>[] {
        return [...valueTests(f, MATCH_DIMS), ...search.tests()];
    }

    /** Signature of the filters that affect `matched` (time/hour are view domains). */
    function matchSig(f: FilterState): string {
        return JSON.stringify([...MATCH_DIMS.map((d) => f[d.key] ?? null), f[SEARCH_KEY] ?? null]);
    }

    let prevMatchSig = '';

    /**
     * Recomputes `matched` in place on the points (mutation, not a new reference)
     * then bumps `matchVersion` to trigger a chart redraw.
     */
    function computeMatched() {
        const filters = messagesExplorerFilters.activeFilters;
        search.apply(filters);
        markMatched(basePoints, filterTests(filters));
        matchVersion += 1;
    }

    /** Past this many people in one group, the segments are thinner than a pixel. */
    const PARTICIPANT_LIMIT = 10;

    /**
     * The others in a group thread, biggest first, with the tail folded into
     * "Other" — the same convention the pies use for their own long tails.
     */
    function participantParts(senders: Map<string, number> | undefined) {
        if (!senders) return undefined;
        const sorted = [...senders.entries()]
            .map(([sender, value]) => ({ sender, value }))
            .sort((a, b) => b.value - a.value);
        const parts = sorted.slice(0, PARTICIPANT_LIMIT);
        const rest = sorted.slice(PARTICIPANT_LIMIT);
        if (rest.length) {
            const value = rest.reduce((s, x) => s + x.value, 0);
            if (value > 0) parts.push({ sender: 'Other', value });
        }
        return parts;
    }

    /**
     * Breakdown of every dimension — the pies, the contact ranking and the stat
     * tiles — in a SINGLE JS pass over the in-memory points (no DB round-trip, so
     * it stays immediate during a brush).
     * Each breakdown excludes its own filter (like the classic bars): per point we
     * collect the failing active dimensions — a point counts for a breakdown if it
     * passes EVERYTHING or if the only dimensions it fails are the ones that
     * breakdown is exempt from (its own, plus `direction` for the ranking). The
     * visible time/hour window (brush) applies throughout.
     */
    function computeBreakdowns() {
        const pts = basePoints;
        if (pts.length === 0) {
            pieSlices = Object.fromEntries(PIE_DIMS.map((d) => [d.key, []]));
            contactRows = [];
            tiles = { messages: 0, words: 0, chars: 0 };
            emojiTally = [];
            termCounts = [];
            return;
        }

        const tests = filterTests(messagesExplorerFilters.activeFilters);
        const window = { time: viewTimeDomain, hour: viewHourDomain };

        const maps: Record<string, Map<string, number>> = {};
        for (const d of PIE_DIMS) maps[d.key] = new Map();
        // The ranking splits every conversation in two, so it tallies each side
        // separately — and remembers which threads are groups.
        const contactTotal = new Map<string, number>();
        const contactSent = new Map<string, number>();
        const groupContacts = new Set<string>();
        // Group threads only: who wrote what, so the bar can carry one colour per
        // person instead of lumping everyone else into a single block.
        const groupSenders = new Map<string, Map<string, number>>();

        let messages = 0;
        let words = 0;
        let chars = 0;
        // Messages per term, for the legend — counted like the tiles, since both
        // describe the selection itself.
        const termTally = search.tally();
        // Already extracted per message when the points were built, so the
        // per-frame cost here is one push per emoji actually typed.
        const selectedEmojis: string[] = [];
        // A search made of emoji alone is the strip's own filter — it is how
        // the strip is clicked — so, like a pie, the strip ignores it: every
        // other emoji stays there to be added beside the first. A search with a
        // word in it still narrows the strip to the emoji that come with it.
        const tallyIgnoresSearch = search.terms.length > 0 && search.terms.every(isWordless);

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!inWindow(p, window)) continue;

            // Two failures still feed the ranking (contact + direction), so the
            // scan only gives up past that.
            const failed: string[] = [];
            for (const test of tests) {
                if (!test.pass(p)) {
                    failed.push(test.key);
                    if (failed.length > 2) break;
                }
            }
            if (failed.length > 2) continue;

            // Every breakdown is weighted by the active measure, so switching it
            // rescales the pies and the ranking in the same pass.
            const weight = measureValue(p);

            if (failed.length <= 1) {
                for (const d of PIE_DIMS) {
                    if (failed.length === 1 && failed[0] !== d.key) continue;
                    const key = p[d.field] as string;
                    const m = maps[d.key];
                    m.set(key, (m.get(key) ?? 0) + weight);
                }
            }

            if (failed.every((k) => RANKING_EXEMPT.has(k))) {
                const contact = p.fContact;
                contactTotal.set(contact, (contactTotal.get(contact) ?? 0) + weight);
                if (p.isGroup) groupContacts.add(contact);
                if (p.fDirection === 'Sent') {
                    contactSent.set(contact, (contactSent.get(contact) ?? 0) + weight);
                } else if (p.isGroup) {
                    let senders = groupSenders.get(contact);
                    if (!senders) {
                        senders = new Map();
                        groupSenders.set(contact, senders);
                    }
                    senders.set(p.fSender, (senders.get(p.fSender) ?? 0) + weight);
                }
            }

            // The tiles describe the current selection itself, so they only count
            // points passing every filter.
            if (failed.length === 0) {
                messages += 1;
                words += p.words;
                chars += p.chars;
                termTally.add(p);
            }
            if (
                failed.length === 0 ||
                (tallyIgnoresSearch && failed.length === 1 && failed[0] === SEARCH_KEY)
            ) {
                for (const emoji of p.emojis) selectedEmojis.push(emoji);
            }
        }

        const nextPies: Record<string, DimensionSlice[]> = {};
        for (const d of PIE_DIMS) nextPies[d.key] = topNSlices(maps[d.key], TOP_N);
        pieSlices = nextPies;

        contactRows = [...contactTotal.entries()]
            .map(([contact, count]) => ({
                contact,
                messages: count,
                sent: contactSent.get(contact) ?? 0,
                isGroup: groupContacts.has(contact),
                parts: participantParts(groupSenders.get(contact)),
            }))
            .sort((a, b) => b.messages - a.messages)
            .slice(0, CONTACT_LIMIT);

        tiles = { messages, words, chars };
        emojiTally = tallyEmojis(selectedEmojis, TALLY_EMOJIS);
        termCounts = termTally.counts;
    }

    // Recompute coalesced in rAF: during the brush, several window changes per
    // frame ⇒ a single recompute.
    let breakdownRaf = 0;
    function scheduleBreakdownRecompute() {
        if (breakdownRaf) return;
        breakdownRaf = requestAnimationFrame(() => {
            breakdownRaf = 0;
            computeBreakdowns();
        });
    }

    let baseSeq = 0;

    async function loadBasePoints() {
        baseSeq += 1;
        const runId = baseSeq;
        try {
            const [nextPoints, domain] = await Promise.all([
                getMessageBasePoints(),
                getMessageTimeDomain(),
            ]);
            if (runId !== baseSeq) return;

            timeDomain = domain;
            basePoints = nextPoints; // stable reference until the next dataset
            search.reset(nextPoints);
            prevMatchSig = matchSig(messagesExplorerFilters.activeFilters);
            computeMatched();
        } catch (e) {
            console.error('Error loading message base points:', e);
        } finally {
            if (runId === baseSeq && initialLoad) initialLoad = false;
        }
    }

    function resetState() {
        baseSeq += 1;
        basePoints = [];
        matchVersion = 0;
        pieSlices = {};
        contactRows = [];
        tiles = { messages: 0, words: 0, chars: 0 };
        emojiTally = [];
        termCounts = [];
        search.reset(null);
        initialLoad = true;
        prevMatchSig = '';
    }

    // Loading the points: ONCE when the source is ready. The point set does not
    // depend on the filters.
    let basePointsLoaded = false;
    $effect(() => {
        const ready = dbReady;
        if (!ready) {
            basePointsLoaded = false;
            resetState();
            return;
        }
        if (basePointsLoaded) return;
        basePointsLoaded = true;
        void loadBasePoints();
    });

    // Constellation highlight: JS recompute of `matched` when the selection
    // changes. The signature avoids useless recomputes (e.g. a time/hour brush)
    // and `untrack` guarantees the in-place mutation of `basePoints` cannot
    // re-trigger this effect (anti-loop).
    $effect(() => {
        if (!dbReady) return;
        const sig = matchSig(activeFilters);
        untrack(() => {
            if (sig === prevMatchSig) return;
            prevMatchSig = sig;
            if (basePoints.length === 0) return;
            computeMatched();
        });
    });

    // Pies, ranking and tiles: JS recompute (immediate, no DB) whenever the
    // points, the selection, or the brush's time/hour window change.
    $effect(() => {
        const _b = basePoints;
        const _m = matchVersion; // proxy for selection changes
        const _t = viewTimeDomain;
        const _h = viewHourDomain;
        const _measure = measure;
        if (!dbReady) return;
        scheduleBreakdownRecompute();
    });

    onDestroy(() => {
        if (breakdownRaf) cancelAnimationFrame(breakdownRaf);
    });

    const indicators = $derived<Indicator[]>([
        { value: tiles.messages.toLocaleString(), label: 'messages' },
        { value: tiles.words.toLocaleString(), label: 'words' },
        { value: tiles.chars.toLocaleString(), label: 'characters' },
    ]);
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div class="explorer-page">
    {#if !dbReady}
        <ModuleEmptyState {module} />
    {:else}
        <div class="header-bar">
            <ExplorerIndicators items={indicators} />

            <div class="header-tools">
                {#if messagesExplorerFilters.hasActiveFilters}
                    <ClearFiltersButton onclick={() => messagesExplorerFilters.clearAll()} />
                {/if}
                <ExplorerSearch
                    value={searchRaw}
                    onChange={setSearch}
                    placeholder="Search the messages"
                    onWarm={() => search.warm()}
                />
            </div>
        </div>

        <section class="explorer-grid" aria-label="Messages explorer layout">
            <article class="chart-placeholder constellation" aria-label="Constellation chart area">
                <div
                    class="constellation-host"
                    bind:clientWidth={containerWidth}
                    bind:clientHeight={containerHeight}
                >
                    {#if initialLoad}
                        <div
                            class="loading-wrapper relative w-full h-full flex items-center justify-center"
                        >
                            <LoadingOverlay message="Rendering conversations..." />
                        </div>
                    {:else if containerWidth > 0 && containerHeight > 0}
                        <ConstellationChart
                            data={basePoints}
                            {matchVersion}
                            width={containerWidth}
                            height={containerHeight}
                            {timeDomain}
                            {colorField}
                            {colorCategories}
                            matchedColor={MATCHED_COLOR}
                            {barValue}
                            formatTooltip={constellationTooltip}
                            bind:viewTimeDomain
                            bind:viewHourDomain
                        >
                            {#snippet legend()}
                                <SearchLegend
                                    entries={searchLegend}
                                    countLabel="messages"
                                    colorByActive={colorByTerm}
                                    onToggleColorBy={() => toggleColorBy(TERM_COLOR_KEY)}
                                    onRemove={(label) => setSearch(withoutTerm(searchRaw, label))}
                                    vizId="messages-explorer"
                                />
                            {/snippet}
                        </ConstellationChart>
                    {/if}
                </div>
            </article>

            <div class="right-column">
                <aside class="chart-placeholder ranking" aria-label="Contact ranking">
                    {#if dbReady && !initialLoad}
                        <ContactRankingPanel
                            rows={contactRows}
                            {measureLabel}
                            selected={selectedContact}
                            onSelect={(v) =>
                                v === null
                                    ? messagesExplorerFilters.removeFilter('contact', 'bar')
                                    : messagesExplorerFilters.setFilter('contact', v, 'bar')}
                        />
                    {/if}
                </aside>

                {#if selectedContact && dbReady && !initialLoad}
                    <aside class="chart-placeholder reader" aria-label="Conversation reader">
                        <ConversationReader
                            contact={selectedContact}
                            messages={readerData.messages}
                            total={readerData.total}
                            later={readerData.later}
                            isGroup={readerData.isGroup}
                            onLoadEarlier={() => (readerBefore += READER_PAGE)}
                            onLoadLater={() => (readerAfter += READER_PAGE)}
                            onClose={() => messagesExplorerFilters.removeFilter('contact', 'bar')}
                            terms={searchTerms}
                            colors={termColors}
                            hits={readerData.hits}
                            focusId={readerData.focus}
                            onFocus={focusMessage}
                        />
                    </aside>
                {:else if searching && dbReady && !initialLoad}
                    <aside class="chart-placeholder reader" aria-label="Search results">
                        <MessageSearchResults
                            hits={searchResults.hits}
                            total={searchResults.total}
                            terms={searchTerms}
                            colors={termColors}
                            onOpen={openHit}
                            onShowMore={() => (resultsLimit += RESULTS_PAGE)}
                        />
                    </aside>
                {/if}

                {#if dbReady && !initialLoad}
                    <div class="emoji-strip">
                        <EmojiTally
                            emojis={emojiTally}
                            hint="Emojis typed in the current selection — reactions not counted. Click one to search for it."
                            onSelect={toggleEmoji}
                            termColor={emojiTermColor}
                        />
                    </div>
                {/if}
            </div>
        </section>

        {#if !initialLoad && dbReady}
            <section class="dimensions-row" aria-label="Dimension breakdowns">
                <MeasureToggle
                    options={MEASURES}
                    value={measure}
                    onChange={(key) => {
                        trackControl('messages-explorer', 'measure', key);
                        measure = key as Measure;
                    }}
                />
                <div class="dimensions-divider" aria-hidden="true"></div>

                {#each PIE_DIMS as pd (pd.key)}
                    <DimensionPie
                        title={pd.label}
                        filterKey={pd.key}
                        slices={pieSlices[pd.key] ?? []}
                        size={pieSize}
                        format={pd.format}
                        sliceValue={(s) => s.plays}
                        formatValue={(v) => `${Math.round(v).toLocaleString()} ${measureLabel}`}
                        selectedValue={firstFilterValue(activeFilters, pd.key)}
                        onSelect={(v) =>
                            v === null
                                ? messagesExplorerFilters.removeFilter(pd.key, 'pie')
                                : messagesExplorerFilters.setFilter(pd.key, v, 'pie')}
                        colorByEnabled
                        colorByActive={colorBy === pd.key}
                        onToggleColorBy={() => toggleColorBy(pd.key)}
                    />
                {/each}
            </section>
        {/if}
    {/if}
</div>

<style>
    .explorer-page {
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        background: var(--bg-primary, hsl(var(--background)));
        color: hsl(var(--foreground));
    }

    .header-bar {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.65rem 1.25rem;
    }

    /* Flush right, so the field holds still while the totals beside it shrink
       with every letter typed; the clear button comes and goes on its left. */
    .header-tools {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
    }

    @media (max-width: 767px) {
        .header-tools {
            width: 100%;
        }
    }

    .dimensions-divider {
        align-self: stretch;
        width: 1px;
        background: hsl(var(--border));
        flex: none;
    }

    .dimensions-row {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem 1.25rem;
        padding: 0.75rem 1rem;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: var(--radius-lg);
        background: var(--bg-secondary, hsl(var(--card)));
    }

    .explorer-grid {
        flex: 1;
        min-height: 0;
        display: grid;
        gap: 1rem;
        grid-template-columns: 2.2fr 1fr;
        grid-template-rows: minmax(0, 1fr);
        grid-template-areas: 'constellation ranking';
    }

    .chart-placeholder {
        min-height: 0;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: var(--radius-lg);
        background: var(--bg-secondary, hsl(var(--card)));
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .constellation {
        grid-area: constellation;
        min-width: 0;
    }

    .constellation-host {
        width: 100%;
        flex: 1;
        min-height: 0;
    }

    /* The ranking owns the right column on its own, and gives half of it to the
       reader once a conversation is open. */
    .right-column {
        grid-area: ranking;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .ranking,
    .reader {
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    /* Under the ranking, and under the conversation when one is open: the tally
       describes the selection, which is what both of them are showing. */
    .emoji-strip {
        flex: none;
        min-width: 0;
        padding-top: 0.5rem;
        border-top: 1px solid hsl(var(--border));
    }

    /* Below a certain width, stack constellation + ranking and let the page
       scroll: impossible to keep everything legible in a single screen. */
    @media (max-width: 1023px) {
        .explorer-page {
            height: auto;
            min-height: 100%;
        }

        .explorer-grid {
            grid-template-columns: 1fr;
            grid-template-rows: auto auto;
            grid-template-areas:
                'constellation'
                'ranking';
        }

        .constellation-host {
            min-height: 26rem;
        }

        .ranking,
        .reader {
            min-height: 22rem;
        }
    }
</style>
