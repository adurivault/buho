import type { MediaKind, Network, ParsedMessage, ParsedThread } from '#lib/types/messages.ts';
import {
    DEMO_GROUPS,
    DEMO_PEOPLE,
    MEDIA_KINDS,
    REACTIONS,
    SELF,
    makeLink,
    makeText,
} from './people';
import { Random, zipfWeights } from './random';

/**
 * Conversations that never happened, shaped like ones that could have.
 *
 * The listening model exists because a flat, uniform history makes every chart
 * in Buho look broken; the same is true here, and the failure modes are
 * specific. A messaging history drawn uniformly gives every contact the same
 * number of messages, every reply the same delay, and every day the same
 * volume — which is exactly the set of things the messages views were built to
 * show. The guide alone asks seven questions of it:
 *
 * - **Who you talk to, month by month.** Needs contacts to *arrive and leave*.
 *   A friendship that runs flat for eight years draws a rectangle.
 * - **Who chases whom.** Needs the sent/received balance to be *per contact*.
 *   One global ratio piles every dot onto the diagonal.
 * - **Who reaches out first.** Needs who opens a conversation to be its own
 *   trait: tie it to the balance and the chart is a copy of the previous one.
 * - **Who answers faster.** Needs two reply speeds per contact, mine and
 *   theirs, drawn from different distributions.
 * - **Friendships over time.** The eras again, at monthly resolution.
 * - **How people react.** Needs reactions to be a minority, unevenly spread,
 *   and *absent from WhatsApp* — which is not a modelling choice but a fact
 *   about the export, and one the sample would be lying about if it ignored it.
 * - **Your conversations in numbers.** Needs media, voice notes and groups to
 *   exist at all.
 *
 * The explorer then asks for two more: a day with a shape, since the
 * constellation's vertical axis is the hour it happened at, and a history with
 * holes in it — a fortnight where the phone was gone reads as truth in a way
 * smoothness never does.
 *
 * The other load-bearing property is that conversation happens in **bursts**.
 * Messages are not independent draws across a day: they come in sessions of a
 * few minutes with replies seconds apart, separated by hours of nothing. That
 * one fact is what gives the constellation its clumps, `session_id` its
 * meaning, and `reply_delay_seconds` a distribution worth taking a median of.
 *
 * Threads are handed back parsed rather than as rows: the sample goes through
 * `buildMessageRows` exactly like a real import, so sessions, reply delays and
 * double texts are derived by the same code that will derive them from your own
 * export. A sample that computed its own would be a sample of something the app
 * never shows.
 */

export interface ConversationOptions {
    /**
     * Same seed and same `until`, same conversations down to the second.
     *
     * As with the listening sample, `until` defaults to today, so the history
     * advances by a day each day. Anything that has to be stable over time — a
     * screenshot, a test — has to pin `until` too.
     */
    seed?: number;
    /** How many years back the history runs. */
    years?: number;
    /** The day the history ends. Defaults to today. */
    until?: Date;
    /** Roughly how many messages to produce. */
    messages?: number;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * When a conversation *starts*, hour by hour, on a working day.
 *
 * Not the same curve as listening: music runs all through the working day,
 * where messaging collapses into the edges of it — a burst before work, a
 * lunchtime, then the long evening that carries most of it.
 */
const WEEKDAY_START_HOURS = [
    0.011, 0.004, 0.002, 0.001, 0.001, 0.003, 0.014, 0.036, 0.048, 0.041, 0.038, 0.046, 0.058,
    0.049, 0.04, 0.042, 0.052, 0.07, 0.082, 0.089, 0.088, 0.076, 0.052, 0.027,
];

/** The same day with nothing to get up for: later, flatter, and longer. */
const WEEKEND_START_HOURS = [
    0.024, 0.014, 0.007, 0.003, 0.002, 0.002, 0.004, 0.012, 0.025, 0.04, 0.052, 0.058, 0.058, 0.052,
    0.05, 0.052, 0.058, 0.066, 0.072, 0.076, 0.074, 0.064, 0.048, 0.032,
];

/**
 * How long each network was the one you actually used, as a fraction of the
 * history: [start, end] in [0, 1].
 *
 * Everybody's messaging moves house every few years, and a sample where all
 * three services run evenly for eight years describes nobody. This is also the
 * only thing that makes the Network pie worth a click.
 */
const NETWORK_ERAS: Record<Exclude<Network, 'unknown'>, [number, number]> = {
    messenger: [0, 0.55],
    instagram: [0.25, 0.85],
    whatsapp: [0.3, 1],
};

/** One correspondent, with everything about them that varies. */
interface Correspondent {
    thread: string;
    network: Exclude<Network, 'unknown'>;
    isGroup: boolean;
    /** Everybody who speaks in the thread, excluding me. */
    others: string[];
    /** Relative share of the whole history. */
    weight: number;
    /** Day index the relationship starts, and how long it lasts. */
    start: number;
    length: number;
    /**
     * Still going. Exempt from the fade, and anchored to the last day of the
     * history — without a few of these the recent months come out emptier than
     * the middle years, and a sample that trails off reads as abandoned.
     */
    current: boolean;
    /** Share of messages in this thread that are mine. */
    sentShare: number;
    /**
     * Share of the conversations here that I open.
     *
     * Deliberately not `sentShare`: who writes the most and who breaks the
     * silence are two different traits, and there are friends you talk to for
     * an hour every time *they* call. Drawn separately so "who reaches out
     * first" says something "who chases whom" didn't already say.
     */
    startShare: number;
    /**
     * How often each side sends again instead of waiting for an answer.
     *
     * This, not `sentShare`, is what actually produces the imbalance. Messages
     * alternate by default, and strict alternation gives every thread a 50/50
     * split however the burst was opened — so "who chases whom" was every dot
     * sitting on the diagonal until the two sides were allowed to run on at
     * different rates. See {@link followRates}.
     */
    myFollow: number;
    theirFollow: number;
    /** Median seconds before I answer them, and before they answer me. */
    myReply: number;
    theirReply: number;
    /** Typical message length here, in words. Some friendships are terser. */
    verbosity: number;
    /** Share of messages carrying an attachment. */
    mediaRate: number;
    /** Share of messages somebody reacts to. Zero on WhatsApp. */
    reactionRate: number;
}

/**
 * The weeks the history simply stops.
 *
 * A lost phone, a hospital stay, a fortnight with no signal — every real export
 * has one and no model produces one by accident. It is the single cheapest
 * thing that stops a generated history reading as generated, and it reads as a
 * band of empty days in the constellation rather than as noise.
 */
interface Outage {
    start: number;
    length: number;
}

export function generateConversations(options: ConversationOptions = {}): ParsedThread[] {
    const { seed = 20260210, years = 8, until = new Date(), messages: target = 38_000 } = options;

    const random = new Random(seed);
    const totalDays = Math.round(years * 365.25);
    const endDay = new Date(until);
    endDay.setHours(0, 0, 0, 0);
    const startMs = endDay.getTime() - totalDays * DAY_MS;

    const roster = buildRoster(random, totalDays);
    const outages: Outage[] = [
        { start: random.int(totalDays * 0.2, totalDays * 0.4), length: random.int(12, 34) },
        { start: random.int(totalDays * 0.6, totalDays * 0.85), length: random.int(6, 15) },
    ];

    /*
     * Two passes over the same grid.
     *
     * The first only adds up how much conversation the model wants; the second
     * scales it so the total lands near `target` and actually writes the
     * messages. Doing it in one pass would mean either guessing the rate
     * constant or getting a history whose size depends on the seed — and the
     * size is the one thing about a sample that has to be predictable, since it
     * decides whether the constellation is a smear or a handful of dots.
     */
    let demand = 0;
    for (const person of roster) {
        for (let day = person.start; day < person.start + person.length; day += 1) {
            demand += intensity(person, day, outages);
        }
    }
    const scale = demand > 0 ? target / demand : 0;

    const threads = new Map<string, ParsedThread>();

    for (const person of roster) {
        const messages: ParsedMessage[] = [];

        for (let day = person.start; day < person.start + person.length; day += 1) {
            if (day < 0 || day >= totalDays) continue;
            const wanted = intensity(person, day, outages) * scale;
            if (wanted <= 0) continue;

            // Fractional days are a coin flip rather than a rounding: a contact
            // worth 0.3 messages a day should be silent most days and talkative
            // on a few, not silent always.
            const budget = Math.floor(wanted) + (random.bool(wanted % 1) ? 1 : 0);
            if (budget <= 0) continue;

            const dayStart = startMs + day * DAY_MS;
            const weekend = [0, 6].includes(new Date(dayStart).getDay());
            const hours = weekend ? WEEKEND_START_HOURS : WEEKDAY_START_HOURS;

            let written = 0;
            while (written < budget) {
                const hour = random.weightedIndex(hours);
                const openedAt = dayStart + hour * HOUR_MS + random.float() * HOUR_MS;
                written += burst(random, person, openedAt, budget - written, messages);
            }
        }

        if (messages.length === 0) continue;

        threads.set(person.thread, {
            network: person.network,
            // The parser that would have produced this thread, because that is
            // what `buildMessageRows` groups by when it works out who "me" is.
            // Two exports, exactly as a real drop would arrive: one WhatsApp
            // transcript set and one Meta archive covering both its services.
            sourceId: person.network === 'whatsapp' ? 'whatsapp-text' : 'meta-json',
            threadName: person.thread,
            participants: [SELF[person.network], ...person.others],
            isGroup: person.isGroup,
            messages,
        });
    }

    return [...threads.values()];
}

/**
 * How much conversation this relationship wants on this day.
 *
 * The envelope is the point: a friendship ramps up over its first weeks, holds,
 * then tails off, and it is that curve — not the total — that the month-by-month
 * charts are drawing. Weekends carry more, because they do.
 */
function intensity(person: Correspondent, day: number, outages: Outage[]): number {
    for (const outage of outages) {
        if (day >= outage.start && day < outage.start + outage.length) return 0;
    }

    const age = (day - person.start) / person.length;
    if (age < 0 || age > 1) return 0;

    // Ramp over the first fifth, fade over the last third; flat between.
    const ramp = Math.min(1, age / 0.2);
    const fade = !person.current && age > 0.67 ? Math.max(0, 1 - (age - 0.67) / 0.33) : 1;

    return person.weight * ramp * fade;
}

/**
 * One session: a run of messages minutes apart, then silence.
 *
 * Whoever speaks first is decided by the thread's `startShare`, and every switch
 * of speaker costs that speaker's own reply time — which is what makes "who
 * answers faster" a question with two different answers per contact rather than
 * one number repeated.
 */
function burst(
    random: Random,
    person: Correspondent,
    openedAt: number,
    remaining: number,
    out: ParsedMessage[]
): number {
    const length = Math.min(remaining, Math.max(1, Math.round(random.logNormal(5, 0.85))));
    let at = openedAt;
    let mine = random.bool(person.startShare);

    for (let index = 0; index < length; index += 1) {
        // The other side is re-picked every message, which is what makes a
        // group a group: three people answering in a row, rather than one
        // nominated speaker taking every turn.
        out.push(
            compose(random, person, mine ? SELF[person.network] : random.pick(person.others), at)
        );

        // Another from the same side, or a real turn. The follow-ups are where
        // `is_double_text` comes from — and they are only a relance when they
        // arrive minutes later, which is why there are two gap shapes.
        if (random.bool(mine ? person.myFollow : person.theirFollow)) {
            at +=
                (random.bool(0.12) ? random.logNormal(900, 0.7) : random.logNormal(24, 0.8)) * 1000;
        } else {
            mine = !mine;
            at += random.logNormal(mine ? person.myReply : person.theirReply, 1.15) * 1000;
        }
    }

    return length;
}

/**
 * Follow-up rates for the two sides of a thread that add up to `sentShare`.
 *
 * With alternation, a side's share of the messages is proportional to how long
 * its runs are, i.e. to `1 / (1 - follow)`. Solving for a given split while
 * holding the average run length at `1 / (1 - base)` gives the pair below; the
 * clamp keeps a very lopsided thread from turning into one person talking to
 * themselves forever.
 */
function followRates(sentShare: number, base = 0.3): [number, number] {
    const ratio = sentShare / (1 - sentShare);
    const mine = clamp((2 * (1 - base)) / (1 + ratio), 0.1, 0.9);
    return [1 - mine, 1 - clamp(ratio * mine, 0.1, 0.9)];
}

/** One message: what kind it is, what it says, and whether anybody reacted. */
function compose(random: Random, person: Correspondent, sender: string, at: number): ParsedMessage {
    const reactions =
        person.reactionRate > 0 && random.bool(person.reactionRate) ? [random.pick(REACTIONS)] : [];

    // Unsent messages exist only where the export records them: WhatsApp's
    // transcript keeps a placeholder line, Meta's JSON a flag.
    if (random.bool(0.004)) {
        return {
            sender,
            text: '',
            timestampMs: at,
            kind: 'placeholder',
            mediaKind: 'none',
            reactions,
            isUnsent: true,
        };
    }

    if (random.bool(person.mediaRate)) {
        const mediaKind = random.pick(MEDIA_KINDS) as MediaKind;
        return {
            sender,
            text: '',
            timestampMs: at,
            kind: 'media',
            mediaKind,
            reactions,
            isUnsent: false,
        };
    }

    if (random.bool(0.035)) {
        return {
            sender,
            text: makeLink(random),
            timestampMs: at,
            kind: 'link',
            mediaKind: 'none',
            reactions,
            isUnsent: false,
        };
    }

    /*
     * Length is long-tailed and then some. Most messages are two words; a few
     * are somebody catching up after a month. A normal distribution here gives
     * every message the same middling length and flattens the length buckets
     * into one bar.
     */
    const words = clamp(Math.round(random.logNormal(person.verbosity, 1.05)), 1, 55);
    const question = random.bool(0.13);

    return {
        sender,
        text: makeText(random, words, question),
        timestampMs: at,
        kind: 'text',
        mediaKind: 'none',
        reactions,
        isUnsent: false,
    };
}

/**
 * The cast, with a life each.
 *
 * Ranks are shuffled before the Zipf weights are handed out, so which friend
 * turns out to be the closest depends on the seed. What does not vary: one or
 * two people are far ahead of everybody, and the bottom of the list is people
 * you exchanged forty messages with over a decade.
 */
function buildRoster(random: Random, totalDays: number): Correspondent[] {
    const people = random.shuffle([...DEMO_PEOPLE]);
    const weights = zipfWeights(people.length, 0.95);
    const roster: Correspondent[] = [];

    people.forEach((person, rank) => {
        const sentShare = clamp(random.normal(0.5, 0.11), 0.24, 0.76);
        // Spread wider than the volume balance: initiative is the more lopsided
        // of the two in a real history, and a narrow draw gives every bar the
        // same length again.
        const startShare = clamp(random.normal(0.5, 0.19), 0.08, 0.92);
        const [myFollow, theirFollow] = followRates(sentShare);
        const [from, to] = NETWORK_ERAS[person.network];
        const windowStart = Math.round(from * totalDays);
        const windowEnd = Math.round(to * totalDays);

        /*
         * The closest few are in your life for most of it; everybody else gets
         * a season or two. Tying duration to rank is what stops the top contact
         * from being someone who appeared for three weeks and left — a real
         * ranking is mostly a ranking of who stayed.
         */
        const current = rank < 4 && random.bool(0.8);
        const span = windowEnd - windowStart;
        const length = Math.max(
            20,
            Math.min(
                span,
                current
                    ? random.int(Math.round(span * 0.7), span)
                    : Math.max(40, Math.round(random.logNormal(span * 0.28, 0.7)))
            )
        );

        roster.push({
            thread: person.name,
            network: person.network,
            isGroup: false,
            others: [person.name],
            weight: weights[rank] * random.range(0.7, 1.4) * 26,
            // Everybody else starts at a moment skewed towards the recent end:
            // you know more people now than eight years ago, and a uniform draw
            // piles the whole roster into the middle of the history.
            start: current
                ? windowEnd - length
                : windowStart + Math.round(Math.pow(random.float(), 0.7) * (span - length)),
            length,
            current,
            sentShare,
            startShare,
            myFollow,
            theirFollow,
            // Minutes, mostly. The interesting spread is between people, not
            // within one thread: some friends answer in seconds and some the
            // next morning, and that is the whole content of the chart.
            myReply: random.logNormal(150, 0.9),
            theirReply: random.logNormal(180, 1),
            verbosity: random.range(3.5, 11),
            mediaRate: random.range(0.02, 0.11),
            reactionRate: person.network === 'whatsapp' ? 0 : random.range(0.03, 0.19),
        });
    });

    DEMO_GROUPS.forEach((group, index) => {
        const sentShare = random.range(0.12, 0.26);
        // Somebody else always starts the group.
        const startShare = random.range(0.03, 0.18);
        const [myFollow, theirFollow] = followRates(sentShare);
        const [from, to] = NETWORK_ERAS[group.network];
        const windowStart = Math.round(from * totalDays);
        const windowEnd = Math.round(to * totalDays);
        const length = Math.max(
            120,
            Math.round(random.logNormal((windowEnd - windowStart) * 0.5, 0.5))
        );

        roster.push({
            thread: group.name,
            network: group.network,
            isGroup: true,
            others: group.members,
            // A group is loud but you are a smaller part of it — which is the
            // point of having one: it moves the sent/received balance somewhere
            // no one-to-one thread goes. Kept well below the top few contacts:
            // at equal weight the groups took a third of the whole history, and
            // dragged the global sent share down with them.
            weight: (index === 0 ? 13 : 7) * random.range(0.8, 1.2),
            start:
                index === 0
                    ? windowEnd - length
                    : random.int(windowStart, Math.max(windowStart, windowEnd - length)),
            length: Math.min(length, windowEnd - windowStart),
            current: index === 0,
            sentShare,
            startShare,
            myFollow,
            theirFollow,
            myReply: random.logNormal(420, 1),
            theirReply: random.logNormal(90, 0.8),
            verbosity: random.range(3, 7),
            mediaRate: random.range(0.08, 0.2),
            reactionRate: group.network === 'whatsapp' ? 0 : random.range(0.08, 0.24),
        });
    });

    return roster;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
