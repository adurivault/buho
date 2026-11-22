import type { Path } from '$app/types';
import { FEEDBACK_EMAIL, FEEDBACK_HREF } from '#lib/feedback.ts';
import { SOURCE_HREF } from '#lib/repo.ts';

/**
 * The questions people ask before they drop a file in, and after.
 *
 * Kept out of the page because `/faq` says every answer twice: once on screen,
 * once in its structured data. Both read from here, so they cannot disagree.
 *
 * How to request each export is `/sources/[source]`'s job. An answer here
 * points there rather than saying it again.
 *
 * Answers and bullets are rendered with `{@html}` for their links and
 * emphasis, so they must stay literals, never anything derived from user data.
 */

export interface FaqLink {
    /** Still needs `resolve()` at the point of use. */
    href: Path;
    label: string;
}

export interface FaqEntry {
    /** Anchor, so a single answer can be linked to on its own. */
    id: string;
    question: string;
    /** One paragraph each, and few of them. */
    answer: string[];
    /** The cases, when the answer is a list of them. */
    bullets?: string[];
    /** Paragraphs after the bullets. */
    after?: string[];
    /** Where to go next. */
    links?: FaqLink[];
}

export interface FaqGroup {
    id: string;
    title: string;
    entries: FaqEntry[];
}

export const FAQ_GROUPS: FaqGroup[] = [
    {
        id: 'about',
        title: 'About Buho',
        entries: [
            {
                id: 'what-is-it-for',
                question: 'What should I use this for?',
                answer: [
                    "Nothing, really. It won't help you set goals, track progress or change anything. It just lets you look at your data and poke around.",
                ],
            },
            {
                id: 'why',
                question: 'Why, then?',
                answer: ['Why not?'],
            },
            {
                id: 'account-and-price',
                question: 'Do I need an account? Is it free?',
                answer: ["No account, and it's free. No ads."],
            },
            {
                id: 'who-makes-this',
                question: 'Who makes this?',
                answer: ['Just me, in my free time.'],
            },
            {
                id: 'written-by-ai',
                question: 'Was it written by an AI?',
                answer: ['Mostly, yes. An AI writes most of the code, and I decide what goes in.'],
            },
            {
                id: 'new-service',
                question: 'Can you add another service?',
                answer: [
                    `Maybe! Send me an email at <a href="${FEEDBACK_HREF}">${FEEDBACK_EMAIL}</a> and tell me which one.`,
                ],
            },
        ],
    },
    {
        id: 'privacy',
        title: 'Privacy',
        entries: [
            {
                id: 'privacy',
                question: 'What about privacy?',
                answer: [
                    "Your data stays on your computer. When you pick a file, the code running in your browser opens it and draws the charts on your screen. It never needs to send the file anywhere, so it doesn't.",
                    "Nothing of yours is saved either. Close the tab and it's all gone. Buho only keeps a copy of its own code, so it can work offline.",
                    `Buho is <a href="${SOURCE_HREF}">open source</a>, so anyone can read the code and check, or run it themselves.`,
                ],
            },
            {
                id: 'tracking',
                question: 'Do you track anything?',
                answer: [
                    'A little. I use <a href="https://umami.is">Umami</a>, a privacy-friendly analytics tool that doesn\'t use cookies. It tells me how many people come by, which pages they visit, whether they load a file and from which service, and which features they use. It never sees what\'s in your file, or who you are.',
                ],
            },
            {
                id: 'still-not-sure',
                question: "I'm still not sure.",
                answer: [
                    'Fair enough. Open Buho, wait a few seconds, turn off your wifi, then pick your file. It works just the same, except for the map backgrounds.',
                    `Or <a href="${SOURCE_HREF}">run it yourself</a>, from the source.`,
                ],
            },
            {
                id: 'verify',
                question: 'How can I check this myself?',
                answer: ["Two ways, if you don't mind a bit of tech:"],
                bullets: [
                    "Open your browser's developer tools, go to the Network tab, and load a file. You'll see Buho load bits of its own code, map tiles if you open a map, and a few small Umami pings. None of them carry your data.",
                    'View the page source and look for <code>Content-Security-Policy</code>. Its <code>connect-src</code> part lists every address the page is allowed to contact: Buho itself, the map tiles (tiles.openfreemap.org) and Umami (cloud.umami.is and gateway.umami.is).',
                ],
            },
        ],
    },
    {
        id: 'exports',
        title: 'Getting your data',
        entries: [
            {
                id: 'which-services',
                question: 'Which services can Buho read?',
                answer: [
                    'Spotify, Deezer and Last.fm for music. Google Timeline, Garmin and Strava for places. Garmin for steps and health too. Google Takeout for your activity on YouTube, Search, Maps and the rest. WhatsApp, Messenger and Instagram for messages.',
                ],
                links: [{ href: 'sources', label: 'Every export, and how to get it' }],
            },
            {
                id: 'how-long',
                question: 'How long until I get my export?',
                answer: [
                    'WhatsApp, Last.fm and Google Timeline: right away. Strava: a few minutes. Google Takeout: minutes to hours. Messenger, Instagram and Garmin: a few hours. Spotify: about a day. Deezer: a few days.',
                    'If you want to try something today, export a WhatsApp chat from your phone.',
                ],
            },
            {
                id: 'wont-read-my-file',
                question: "Buho says it can't read my file.",
                answer: ["It's usually the wrong export, not a broken one."],
                bullets: [
                    '<strong>Spotify</strong>: ask for the "Extended streaming history", not the account data.',
                    '<strong>Google Takeout</strong>: pick JSON, not HTML.',
                    '<strong>Instagram and Messenger</strong>: drop the .zip as it arrived, or the whole folder. Not the files inside.',
                ],
                after: [
                    `If it still doesn't work, email me at <a href="${FEEDBACK_HREF}">${FEEDBACK_EMAIL}</a>.`,
                ],
            },
            {
                id: 'history-too-short',
                question: 'My history is shorter than it should be.',
                answer: [
                    'On Spotify, the account data only covers the last year. Ask for the extended history instead.',
                    'On Messenger, most chats switched to end-to-end encryption in 2023 or 2024, and everything after that comes in a separate "secure storage" download. Request both and drop both. They merge.',
                ],
            },
            {
                id: 'several-exports',
                question: 'Can I load several exports?',
                answer: [
                    'Yes, they add up. A single Garmin export fills Positions, Steps and Health.',
                    'Watch out for overlaps: Spotify and Last.fm over the same years will count every song twice. You can remove any source and keep the rest.',
                ],
            },
            {
                id: 'how-big',
                question: 'How big a file can it handle?',
                answer: [
                    "Your computer's memory is the limit. A Spotify export opens instantly. A big Google or Garmin archive can take a minute. If a huge Takeout zip fails, unzip it yourself and choose the folder instead.",
                ],
            },
        ],
    },
    {
        id: 'google-timeline',
        title: 'Google Timeline',
        entries: [
            {
                id: 'timeline-what',
                question: 'What is Google Timeline?',
                answer: [
                    "A Google Maps feature that records where you go with your phone: the places you visit and the routes between them. It only works if you've turned it on.",
                ],
            },
            {
                id: 'timeline-where',
                question: 'Where is it stored?',
                answer: [
                    "On your phone. Since 2025, it's no longer on Google's servers, and no longer in Google Takeout. So the export has to come from the phone.",
                ],
            },
            {
                id: 'timeline-export',
                question: 'How do I export it?',
                answer: [
                    'From the phone, then send the file to your computer (email, AirDrop, cable).',
                ],
                bullets: [
                    '<strong>Android</strong>: Settings › Location › Location services › Timeline › Export Timeline data.',
                    '<strong>iPhone</strong>: Google Maps › your profile picture › Your Timeline › ⋮ › Location &amp; privacy settings › Export Timeline data.',
                ],
                links: [{ href: 'sources/google-timeline', label: 'Step by step' }],
            },
        ],
    },
    {
        id: 'using-it',
        title: 'Using it',
        entries: [
            {
                id: 'coolest-charts',
                question: 'Which charts are the coolest?',
                answer: ['My favorites:'],
                bullets: [
                    '"Every day at once" in the Positions guide. Or anything with Google Timeline, really. You\'ll need Timeline turned on in Google Maps, though.',
                    'The calendar, with several exports loaded. Your music, places, messages and steps, day by day, on the same page.',
                ],
                links: [
                    { href: 'positions/guide', label: 'Positions guide' },
                    { href: 'calendar', label: 'Calendar' },
                ],
            },
            {
                id: 'try-without-data',
                question: 'Can I try it without my own data?',
                answer: [
                    'Yes, I generated synthetic data to get a feel of what you\'ll have with your data. Just click "Load Demo Data"',
                ],
            },
            {
                id: 'guide-or-explore',
                question: 'Guide or Explore?',
                answer: [
                    'The guide walks you through your data, one chart at a time. Explore gives you everything at once, with filters that update all the charts together. Listening, Positions and Messages have a guide. Start there.',
                ],
            },
            {
                id: 'phone',
                question: 'Does it work on a phone?',
                answer: [
                    'Partly. You get the guides, but the explorers need a bigger screen. Getting a big export onto your phone is the hard part anyway.',
                ],
            },
        ],
    },
];

/** Every entry, flattened: for the structured data and for the tests. */
export const FAQ_ENTRIES: FaqEntry[] = FAQ_GROUPS.flatMap((group) => group.entries);

/** An entry's paragraphs and bullets as one string, in order, markup included. */
export function entryText(entry: FaqEntry): string {
    return [...entry.answer, ...(entry.bullets ?? []), ...(entry.after ?? [])].join(' ');
}
