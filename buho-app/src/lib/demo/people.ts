import type { Network } from '#lib/types/messages.ts';
import type { Random } from './random';

/**
 * The cast of the sample conversations, and the words they use.
 *
 * Kept apart from the model for the same reason the artist catalog is: the
 * shape of a messaging history and the words inside it are two different
 * problems, and only one of them is interesting. It also keeps both out of the
 * main bundle — `demo/load.ts` imports the generator dynamically, so a visitor
 * with their own export never downloads any of this.
 *
 * Every name here is invented, and deliberately plain. The sample has to look
 * like somebody's conversations without looking like anybody's.
 */

/**
 * Who the export belongs to, spelled the way each service spells it.
 *
 * Not one string, because it is not one string in real exports: Meta writes the
 * name on the account, WhatsApp writes whatever the phone's contact card says.
 * `detectSelf` settles the owner per export precisely because these disagree,
 * and a sample where they agreed would be exercising an easier problem than the
 * one the importer actually has.
 */
export const SELF: Record<Network, string> = {
    messenger: 'Alex Moreau',
    instagram: 'Alex Moreau',
    whatsapp: 'Alex',
    unknown: 'Alex',
};

export interface DemoPerson {
    name: string;
    network: Exclude<Network, 'unknown'>;
}

/**
 * The roster, in no particular order — the model shuffles it and hands out a
 * Zipf weight per rank, so who turns out to be the closest friend depends on
 * the seed rather than on the order they were typed in.
 *
 * The network split is the migration story: Messenger carries the early years,
 * Instagram the middle, WhatsApp the recent ones. Nobody is on two of them —
 * `contact` is what every per-person chart groups by, and one human appearing
 * as one row is worth more than the realism of having moved services.
 */
export const DEMO_PEOPLE: DemoPerson[] = [
    { name: 'Camille Berger', network: 'whatsapp' },
    { name: 'Nadia Fournier', network: 'whatsapp' },
    { name: 'Tom Vasquez', network: 'whatsapp' },
    { name: 'Léa Marchand', network: 'whatsapp' },
    { name: 'Youssef Karim', network: 'whatsapp' },
    { name: 'Ingrid Solberg', network: 'whatsapp' },
    { name: 'Marco Fenn', network: 'whatsapp' },
    { name: 'Priya Raman', network: 'whatsapp' },
    { name: 'Hugo Delattre', network: 'whatsapp' },
    { name: 'Sofia Almeida', network: 'whatsapp' },
    { name: 'Bastien Roux', network: 'whatsapp' },
    { name: 'Mei Tanaka', network: 'whatsapp' },
    { name: 'Oscar Lindqvist', network: 'messenger' },
    { name: 'Amina Diallo', network: 'messenger' },
    { name: 'Julien Pastor', network: 'messenger' },
    { name: 'Klara Novak', network: 'messenger' },
    { name: 'Ravi Menon', network: 'messenger' },
    { name: 'Elodie Chastain', network: 'messenger' },
    { name: 'Peter Nagy', network: 'messenger' },
    { name: 'Sarah Whitfield', network: 'messenger' },
    { name: 'Dario Costa', network: 'instagram' },
    { name: 'Nour Haddad', network: 'instagram' },
    { name: 'Jonas Meyer', network: 'instagram' },
    { name: 'Talia Brooks', network: 'instagram' },
    { name: 'Kenji Aoki', network: 'instagram' },
    { name: 'Rosa Iglesias', network: 'instagram' },
];

export interface DemoGroup {
    name: string;
    network: Exclude<Network, 'unknown'>;
    members: string[];
}

/**
 * Group threads, which behave nothing like one-to-one ones: several people
 * talking past each other, long silences, and a burst whenever something is
 * being organised. Without at least one, `is_group` is a column that is always
 * false and the busiest thread is always a single person.
 */
export const DEMO_GROUPS: DemoGroup[] = [
    {
        name: 'Sunday football',
        network: 'whatsapp',
        members: ['Tom Vasquez', 'Marco Fenn', 'Youssef Karim', 'Bastien Roux', 'Hugo Delattre'],
    },
    {
        name: 'Flat 4B',
        network: 'whatsapp',
        members: ['Camille Berger', 'Léa Marchand', 'Sofia Almeida'],
    },
    {
        name: 'Trip planning ✈️',
        network: 'messenger',
        members: ['Oscar Lindqvist', 'Amina Diallo', 'Klara Novak', 'Peter Nagy'],
    },
];

// ---------------------------------------------------------------------------
// What people say
// ---------------------------------------------------------------------------

/**
 * The vocabulary is built in clauses rather than whole messages so that length
 * is a knob rather than a lookup. Length is doing real work here: it drives the
 * length buckets, the words and characters measures, and half of what makes a
 * thread read as a conversation rather than a list.
 */

/** One to three words. Most of what anybody actually sends. */
const TINY = [
    'ok',
    'yes',
    'no',
    'sure',
    'haha',
    'lol',
    'true',
    'same',
    'nice',
    'omg',
    'exactly',
    'perfect',
    'agreed',
    'oh no',
    'wait what',
    'no way',
    'on my way',
    'be there soon',
    'sorry',
    'thanks',
    'thank you',
    'good night',
    'morning',
    'see you there',
    'done',
    'got it',
    'fair enough',
    'that works',
    'ugh',
    'finally',
    'congrats',
    'good luck',
    'let me check',
    'one sec',
    'yeah ok',
];

/** Ordinary sentences, joined together when a longer message is wanted. */
const CLAUSES = [
    'I finished the thing I was complaining about last week',
    'the train was late again so I read most of a book',
    'we ended up staying much longer than planned',
    'I have been trying to sort out that paperwork for a month',
    'the weather turned right as I left the house',
    'I think I left my jacket at yours',
    'work has been quiet which is suspicious',
    'the flat above me has started renovating at seven in the morning',
    'I made that recipe you sent and it actually worked',
    'my phone died halfway through so I missed everything',
    'we should do that again before the summer ends',
    'I got completely lost on the way back',
    'there were about four people there in the end',
    'I have been sleeping badly and it shows',
    'the place has changed a lot since we went',
    'I signed up for the class after all',
    'nobody warned me it would take three hours',
    'I keep meaning to reply properly and then forgetting',
    'the film was much longer than anyone said',
    'I have been walking everywhere to avoid the bus',
    'apparently the whole thing was moved to next month',
    'I found the photos from that weekend',
    'it took two attempts but it is done',
    'the coffee place near the station closed',
    'I am trying to be better about calling people',
    'we talked for about three hours without noticing',
    'I have been listening to that album on repeat',
    'the plan changed twice while I was on the train',
    'I ended up cooking for eight people somehow',
    'my neighbour adopted a truly enormous dog',
    'I still owe you for the tickets',
    'the deadline moved which helps a lot',
    'I walked past your old place yesterday',
    'everything is fine it was just a long week',
    'I have decided to stop checking the news before bed',
    'the flight was delayed but only by an hour',
    'I bought the wrong size and cannot be bothered to return it',
    'they rebuilt the whole street while I was away',
];

/** Questions, so `has_question` is not a column of falses. */
const QUESTIONS = [
    'are you around this weekend?',
    'did you ever hear back about that?',
    'what time were you thinking?',
    'is that still happening?',
    'can you send me the address?',
    'how did it go in the end?',
    'do you want me to bring anything?',
    'are you feeling any better?',
    'should we just book it?',
    'did I leave my keys with you?',
    'what did they say?',
    'is next Thursday any good?',
    'have you eaten?',
    'can I call you later?',
    'was it as bad as you expected?',
    'do you still have that photo?',
    'are you taking the train or driving?',
    'how many people are coming?',
    'did you manage to sleep?',
    'want to get something to eat?',
];

/** Sprinkled in, so `emoji_count` means something. */
const EMOJI = ['🙂', '😂', '❤️', '🙃', '👀', '🎉', '😅', '🤞', '☀️', '🥲'];

/** Reactions, which only exist on the Meta exports — WhatsApp drops them. */
export const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

/** Links, as they appear in a transcript: the URL is the message. */
const LINKS = [
    'https://example.org/a-long-article-nobody-will-read',
    'https://example.com/listing/4821',
    'https://example.net/photos/august',
    'https://example.org/recipe/slow-onions',
    'https://example.com/events/2291',
];

/** A message that is only an attachment carries no text in either export. */
export const MEDIA_KINDS = ['photo', 'voice', 'gif', 'video', 'other'] as const;

/**
 * A message body of roughly `words` words.
 *
 * Under four words it is one of the stock replies, because that is what short
 * messages actually are — not a truncated sentence. Above that, clauses are
 * joined until the budget runs out, which is why long messages read as somebody
 * catching up rather than as a paragraph of filler.
 */
export function makeText(random: Random, words: number, question: boolean): string {
    if (question) return random.pick(QUESTIONS);
    if (words <= 3) return random.pick(TINY);

    /*
     * Six clauses is the ceiling, and no clause twice.
     *
     * Without both, a long-tailed word budget produced four-hundred-word
     * messages built by joining the same sentence to itself with commas, which
     * is not what a long message looks like — it is what filler looks like, and
     * one of them on screen is enough to give the whole sample away.
     */
    const parts: string[] = [];
    let count = 0;
    for (let attempt = 0; attempt < 12 && count < words && parts.length < 6; attempt += 1) {
        const clause = random.pick(CLAUSES);
        if (parts.includes(clause)) continue;
        parts.push(clause);
        count += clause.split(' ').length;
    }

    let text = parts[0];
    for (const clause of parts.slice(1)) {
        text += (random.bool(0.55) ? '. ' : ', ') + clause;
    }
    if (random.bool(0.14)) text += ` ${random.pick(EMOJI)}`;
    return text;
}

/** A message that is a link and nothing else. */
export function makeLink(random: Random): string {
    return random.pick(LINKS);
}
