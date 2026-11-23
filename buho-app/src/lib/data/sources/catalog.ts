import type { IconName } from '#lib/components/icons.ts';
import type { Network } from '#lib/types/messages.ts';
import { DATA_MODULES, type DataModule, type ModuleId } from '../modules';

/**
 * The two axes of what Buho reads, described once for the /sources page.
 *
 * Sources and modules are deliberately not the same list: one export can feed
 * two modules (a Garmin archive carries both GPS tracks and step counters) and
 * one module can be fed by several exports (positions come from Google and from
 * a watch; conversations from three different services). The /sources page is
 * the one place that relationship is stated in full.
 *
 * This is documentation, not routing — the parsers in `SOURCE_PARSERS` decide
 * what is actually read. `parserIds` ties each row back to the modules doing the
 * work, and `catalog.test.ts` fails if the two drift apart.
 */

/** Where to request an export, when the provider has a page for it. */
export interface ExportLink {
    href: string;
    label: string;
}

/**
 * How long you wait before the export is in your hands, as a sortable tier.
 *
 * {@link CatalogSource.delay} says it in words and is what people read; this
 * says it in an order, and exists because the onboarding funnel has to lead with
 * the exports you can get in one sitting. The gap is not a detail — a WhatsApp
 * chat is on your disk in seconds, and the exports you have to request come back
 * days later, whatever the provider's own worst case says.
 *
 * `instant` means the provider makes you wait for nothing — you fetch it
 * yourself, in the same sitting.
 */
export type ExportWait = 'instant' | 'minutes' | 'hours' | 'days';

/** Soonest first. The funnel's source list is sorted on this. */
export const EXPORT_WAIT_ORDER: ExportWait[] = ['instant', 'minutes', 'hours', 'days'];

/**
 * One of the downloads an export is split across: what it holds, where to ask
 * for it, and what to do there.
 */
export interface GuideDownload {
    /** What this download holds that the other does not, in a few words. */
    title: string;
    /** One sentence on what it covers. */
    body: string;
    link: ExportLink;
    /** What to do on that page, up to the request. */
    steps: string[];
}

/**
 * How to actually get this export, in the three stages every export goes
 * through: get it out of the service, wait for it (or carry it over from the
 * phone), drop it into Buho.
 *
 * Lives on the catalog row rather than in the import dialog because the dialog
 * shows whichever guide you ask for — there is one drop zone for all eight
 * sources now, so there is no per-service dialog left to hold the prose.
 *
 * `steps`, `warning`, `dropNote`, the `body` fields and the `note` fields are
 * rendered with `{@html}` for their inline emphasis, so they must stay
 * literals: never anything derived from user data.
 */
export interface SourceGuide {
    /** One or two sentences on what this export is, before the stages. */
    intro: string;
    /**
     * What a reader has to understand about the service before the steps make
     * sense — a feature they may never have turned on, a change in how it
     * stores things. Three short points at most; `catalog.test.ts` holds it to
     * that.
     */
    background?: { title: string; points: string[] };
    /** The first stage's heading, in this export's terms: "Request it from Spotify". */
    get: string;
    /** The few settings that decide whether the export is usable at all. */
    settings?: Array<{ label: string; value: string; note?: string }>;
    /**
     * What to do on the provider's side, in order, up to the request. Waiting
     * for the file and dropping it are stages of their own, not steps.
     */
    steps: string[];
    /**
     * Where the steps differ by device. Used by Google Timeline, whose export
     * moved into the phone's own settings and sits in a different place on each
     * platform; `steps` is then empty and these replace it.
     */
    platforms?: Array<{ id: string; label: string; steps: string[] }>;
    /**
     * The downloads a service splits its data across, each with its own page
     * and steps; `steps` is then empty and these replace it, along with the
     * source's `link`. Messenger is the case: since Meta turned on end-to-end
     * encryption, the standard export stops at the switchover date.
     */
    downloads?: GuideDownload[];
    /** The one mistake made while asking for it, said under the first stage. */
    warning?: string;
    /** The second stage: what stands between the request and the file in hand. */
    wait: { title: string; body: string };
    /** The one thing to know when handing the file over, beside the drop zone. */
    dropNote?: string;
}

/** One export you can hand to Buho. */
export interface CatalogSource {
    id: string;
    label: string;
    /**
     * The sentence a search result shows under this source's page title.
     *
     * Written out rather than assembled from {@link request}, {@link format} and
     * {@link delay}: those are labels, capitalised to stand alone, and stitched
     * into one sentence they read as a form. Within 160 characters, past which
     * results cut it off — `catalog.test.ts` holds every row to that.
     */
    metaDescription: string;
    /**
     * The registered parsers that claim this source's files.
     *
     * Not one-to-one either way: Messenger and Instagram share a parser (their
     * archives are byte-for-byte the same schema), Messenger has a second one for
     * converted exports, and Spotify has none at all — its import predates the
     * registry and reads the dropped files directly.
     */
    parserIds: string[];
    /** The glyph standing for this source on /sources and in the import dialog. */
    icon: IconName;
    /**
     * For the three messaging services, which share one glyph and one module:
     * refines {@link icon} down to the individual service.
     */
    network?: Network;
    /** The export to ask for, in the provider's own wording. */
    request: string;
    /** What actually reaches your disk. */
    format: string;
    /** Roughly how heavy the download is — an order of magnitude, not a promise. */
    size: string;
    /** How long the provider takes to send it. */
    delay: string;
    /** The same answer as {@link delay}, in an order the funnel can sort on. */
    wait: ExportWait;
    /**
     * The export is made in the phone's own apps rather than requested from a
     * website. On a phone these lead the list: they are the ones a visitor can
     * finish in the same sitting, on the device already in their hand.
     */
    madeOnPhone?: boolean;
    /** The modules it feeds. */
    fills: ModuleId[];
    link?: ExportLink;
    /** How to obtain it: the import dialog, onboarding and the source page all show it. */
    guide: SourceGuide;
}

export const CATALOG_SOURCES: CatalogSource[] = [
    {
        id: 'spotify',
        label: 'Spotify',
        metaDescription:
            'Request your Spotify extended streaming history — every play since your first, in about a day — and chart it in your browser. Nothing leaves your device.',
        icon: 'spotify',
        parserIds: ['spotify-json'],
        request: 'Extended streaming history',
        format: '.json files, in a .zip',
        size: 'A few MB, all of it text',
        delay: 'Around 24 hours',
        wait: 'hours',
        fills: ['listening'],
        link: {
            href: 'https://www.spotify.com/account/privacy/',
            label: 'Spotify privacy settings',
        },
        guide: {
            intro: 'Spotify offers two exports on the same privacy page. Buho needs the extended streaming history, which covers every play since the account was created.',
            get: 'Request it from Spotify',
            settings: [
                {
                    label: 'Request',
                    value: 'Extended streaming history',
                    note: "Not 'Account data', which only covers the last year.",
                },
            ],
            steps: [
                'Scroll to <strong>Download your data</strong> and tick <strong>Extended streaming history</strong>.',
                'Click <strong>Request data</strong>, then confirm in the email Spotify sends.',
            ],
            wait: {
                title: 'Wait for the email',
                body: 'Spotify emails a download link, usually within a day. It can take up to 30 days.',
            },
            dropNote:
                'The zip also holds account files. Buho skips them, so you can drop it as is.',
        },
    },
    {
        id: 'deezer',
        label: 'Deezer',
        metaDescription:
            'Request your Deezer listening history — one .xlsx workbook, a few days away — and chart it in your browser. Nothing leaves your device.',
        icon: 'deezer',
        parserIds: ['deezer-xlsx'],
        request: 'My personal data',
        format: 'One .xlsx workbook',
        size: 'Under a megabyte',
        delay: 'A few days',
        wait: 'days',
        fills: ['listening'],
        link: {
            href: 'https://www.deezer.com/account/personal_data',
            label: "Deezer's personal data page",
        },
        guide: {
            intro: 'Deezer sends a single spreadsheet with all the data it holds on you. Buho reads the listening history sheet.',
            get: 'Request it from Deezer',
            steps: ['Request your personal data. There are no options to set.'],
            warning:
                'Deezer&rsquo;s history is <strong>partial</strong>. Expect a few thousand plays, with whole years missing.',
            wait: {
                title: 'Wait for the email',
                body: 'Deezer emails a link, usually within a few days.',
            },
        },
    },
    {
        id: 'lastfm',
        label: 'Last.fm',
        metaDescription:
            'Export your Last.fm scrobbles as JSON in seconds — no login, no API key — and chart them in your browser. Nothing leaves your device.',
        icon: 'lastfm',
        parserIds: ['lastfm-json'],
        request: 'Scrobbles, as JSON, from the community export tool',
        format: 'One .json file',
        size: 'Around 100 MB for 100k scrobbles, mostly album art URLs',
        delay: 'Immediate',
        wait: 'instant',
        fills: ['listening'],
        link: {
            href: 'https://mainstream.ghan.nl/export.html',
            label: "Last.fm's community export tool",
        },
        guide: {
            intro: 'Last.fm has no export of its own. A community tool downloads your scrobbles through the public API. It needs no login or API key.',
            get: 'Export it with the community tool',
            settings: [
                {
                    label: 'Export type',
                    value: 'Scrobbles',
                },
                {
                    label: 'Format',
                    value: 'JSON',
                    note: 'Not CSV or XML.',
                },
            ],
            steps: [
                'Open the tool and enter your <strong>Last.fm username</strong>.',
                'Pick <strong>Scrobbles</strong> and <strong>JSON</strong>, then click <strong>Go</strong>.',
            ],
            warning:
                'If you also import Spotify for the same years, each play is counted twice, once per service.',
            wait: {
                title: 'Wait for the tool to finish',
                body: "Keep the page open. It fetches 200 scrobbles per request, so a long history takes a few minutes. Then save the file, named <code class='text-xs'>scrobbles-&lt;user&gt;-&lt;number&gt;.json</code>.",
            },
            dropNote:
                'The number in the filename marks where the export stopped. Enter it in the tool later to fetch only newer scrobbles, then drop the new file too. Buho removes the overlap.',
        },
    },
    {
        id: 'google-timeline',
        label: 'Google Timeline',
        metaDescription:
            'Export your Google Timeline location history from your phone (it left Takeout) and map every visit in your browser. Nothing leaves your device.',
        icon: 'map-pin',
        parserIds: ['google-timeline'],
        request: 'Export Timeline data, from the phone',
        format: 'Timeline.json (or location-history.json)',
        size: 'Tens of MB for a decade',
        delay: 'Immediate',
        wait: 'instant',
        madeOnPhone: true,
        fills: ['positions'],
        guide: {
            intro: 'Timeline is a Google Maps feature that records the places you visit and the routes between them.',
            background: {
                title: 'About Timeline',
                points: [
                    'It is off by default. Once you turn it on, in Google Maps &rarr; your profile &rarr; <strong>Your Timeline</strong>, your phone keeps recording your location.',
                    'Google used to store it on its servers, and Takeout could export it. It is now stored <strong>on your phone only</strong>, so you export it from the phone.',
                    'It starts on the day you turn it on. A new Timeline deletes data older than <strong>3 months</strong> unless you turn off auto-delete in its settings.',
                ],
            },
            get: 'Export it from your phone',
            steps: [],
            platforms: [
                {
                    id: 'android',
                    label: 'Android',
                    steps: [
                        "Open your phone's <strong>Settings</strong> app (not Google Maps).",
                        'Go to <strong>Location</strong> → <strong>Location services</strong> → <strong>Timeline</strong>. Pick your Google account if asked.',
                        'Tap <strong>Export Timeline data</strong> and choose where to save the file.',
                    ],
                },
                {
                    id: 'ios',
                    label: 'iPhone',
                    steps: [
                        'Open <strong>Google Maps</strong> and tap your <strong>profile picture</strong> in the top right.',
                        'Tap <strong>Your Timeline</strong>.',
                        'Tap <strong>⋮</strong> in the top right, then <strong>Location &amp; privacy settings</strong>.',
                        'Tap <strong>Export Timeline data</strong>.',
                    ],
                },
            ],
            warning: "Menu names follow your phone's language and change between versions.",
            wait: {
                title: 'Send it to your computer',
                body: "Use email, Drive, AirDrop or a cable. The file is called <code class='text-xs'>Timeline.json</code> or <code class='text-xs'>location-history.json</code>.",
            },
        },
    },
    {
        id: 'google-activity',
        label: 'Google Takeout',
        metaDescription:
            'Export Google My Activity from Takeout as JSON — YouTube, Search, Maps and more — and chart every entry in your browser. Nothing leaves your device.',
        icon: 'google-activity',
        parserIds: ['google-activity'],
        request: 'My Activity, as JSON',
        format: '.json files, in a .zip',
        size: 'Hundreds of MB and up, depending on what you tick',
        delay: 'Minutes to hours',
        wait: 'minutes',
        fills: ['activity'],
        link: { href: 'https://takeout.google.com/settings/takeout', label: 'Google Takeout' },
        guide: {
            intro: 'Takeout exports the data of every Google service. Buho reads "My Activity", in JSON.',
            get: 'Request it from Google Takeout',
            settings: [
                {
                    label: 'Format',
                    value: 'JSON',
                },
                {
                    label: 'Data',
                    value: 'My Activity',
                    note: 'Buho ignores the rest of a Takeout.',
                },
            ],
            steps: [
                'Click <strong>Deselect all</strong>, then tick <strong>My Activity</strong>.',
                'Click <strong>Multiple formats</strong> on that row and set <strong>Activity records</strong> to <strong>JSON</strong>.',
                'Under <strong>All activity data included</strong>, keep everything or pick YouTube, Search and Maps.',
                'Request the export.',
            ],
            wait: {
                title: 'Wait for the email',
                body: 'Google emails a link, usually within a few minutes to a few hours.',
            },
            dropNote:
                'Large Takeout zips can be too big for the browser to unpack. If that happens, unzip it yourself and use <strong>Choose a folder</strong>, which has no size limit.',
        },
    },
    {
        id: 'messenger',
        label: 'Messenger',
        metaDescription:
            'Export your Messenger chats as JSON, encrypted conversations included, and chart every thread in your browser. Nothing leaves your device.',
        icon: 'message',
        parserIds: ['meta-json', 'normalized-json'],
        network: 'messenger',
        request: 'Download your information → Messages, as JSON',
        format: 'message_1.json files, in one or more .zip',
        size: 'Hundreds of MB, nearly all of it attachments',
        delay: 'Hours',
        wait: 'hours',
        fills: ['messages'],
        guide: {
            intro: 'Messenger conversations come in two downloads. Buho merges them.',
            background: {
                title: 'Why two downloads',
                points: [
                    'Since late 2023, Meta has been switching Messenger chats to <strong>end-to-end encryption</strong>. Meta can no longer read those messages. They are kept in your <strong>secure storage</strong>, protected by your PIN.',
                    'Meta&rsquo;s usual export only contains what it can read: messages from before each chat switched, and group chats. The rest comes from a separate export of the secure storage.',
                ],
            },
            get: 'Request two downloads from Meta',
            settings: [
                {
                    label: 'Format',
                    value: 'JSON',
                },
                {
                    label: 'Date range',
                    value: 'All time',
                    note: 'The default is the last few months only.',
                },
                {
                    label: 'Media quality',
                    value: 'Low',
                },
            ],
            steps: [],
            downloads: [
                {
                    title: 'Encrypted chats',
                    body: 'One-to-one chats since they switched to encryption, between late 2023 and 2024 depending on the account.',
                    link: {
                        href: 'https://www.messenger.com/secure_storage/dyi',
                        label: 'Messenger secure-storage export',
                    },
                    steps: [
                        'Unlock the form with your <strong>Messenger PIN</strong>, the one you set up for encrypted chats.',
                        'Set the three settings above and request the download.',
                    ],
                },
                {
                    title: 'Older chats and groups',
                    body: 'Messages from before the switch, and group chats.',
                    link: {
                        href: 'https://accountscenter.facebook.com/info_and_permissions/dyi',
                        label: "Meta's ordinary export form",
                    },
                    steps: [
                        'Choose <strong>Some of your information</strong> &rarr; <strong>Messages</strong>.',
                        'Set the same three settings and request the download.',
                    ],
                },
            ],
            wait: {
                title: 'Wait for both emails',
                body: 'The usual export takes a few minutes, the encrypted one a few hours.',
            },
            dropNote:
                'Large exports come as several zip files. Download all of them from both requests and drop them together.',
        },
    },
    {
        id: 'instagram',
        label: 'Instagram',
        metaDescription:
            'Export your Instagram DMs as JSON from the Accounts Center and chart every conversation in your browser. Nothing leaves your device.',
        icon: 'message',
        parserIds: ['meta-json'],
        network: 'instagram',
        request: 'Download your information → Messages, as JSON',
        format: 'message_1.json files, in one or more .zip',
        size: 'Hundreds of MB, nearly all of it attachments',
        delay: 'Hours',
        wait: 'hours',
        fills: ['messages'],
        link: {
            href: 'https://accountscenter.instagram.com/info_and_permissions/dyi/',
            label: "Instagram's export page",
        },
        guide: {
            intro: 'Instagram uses the same export form as Messenger, in the Accounts Center. Buho tells the two apart.',
            get: 'Request it from Instagram',
            settings: [
                {
                    label: 'Format',
                    value: 'JSON',
                },
                {
                    label: 'Date range',
                    value: 'All time',
                    note: 'The default is the last few months only.',
                },
                {
                    label: 'Media quality',
                    value: 'Low',
                },
            ],
            steps: [
                'Choose <strong>Download or transfer information</strong>, then your Instagram account.',
                'Select <strong>Some of your information</strong> and tick <strong>Messages</strong>. Anything else you tick is ignored.',
                'Set the three settings above and request the download.',
            ],
            wait: {
                title: 'Wait for the email',
                body: 'Meta emails you, usually within a few hours.',
            },
            dropNote:
                'Large exports come as several zip files. Download all of them and drop them together, zipped or unzipped. Keep the folder structure, which Buho uses to recognise Instagram.',
        },
    },
    {
        id: 'whatsapp',
        label: 'WhatsApp',
        metaDescription:
            'Export a WhatsApp chat from your phone in seconds, without media, and chart who said what and when in your browser. Nothing leaves your device.',
        icon: 'message',
        parserIds: ['whatsapp-text'],
        network: 'whatsapp',
        request: 'Export chat → Without media, one conversation at a time',
        format: '.txt, one per conversation',
        size: 'A few hundred KB per conversation, without media',
        delay: 'Immediate',
        wait: 'instant',
        madeOnPhone: true,
        fills: ['messages'],
        guide: {
            intro: 'WhatsApp exports one conversation at a time, from the phone app.',
            get: 'Export each chat from your phone',
            settings: [
                {
                    label: 'Attachments',
                    value: 'Without media',
                },
            ],
            steps: [
                'Open a conversation and tap its name at the top.',
                'Tap <strong>Export chat</strong>, then <strong>Without media</strong>.',
                'Repeat for each conversation you want.',
            ],
            wait: {
                title: 'Send them to your computer',
                body: "Use email, AirDrop or a cloud drive. Each conversation is a <code class='text-xs'>.txt</code> file.",
            },
            dropNote: 'You can drop all the files at once.',
        },
    },
    {
        id: 'garmin',
        label: 'Garmin Connect',
        metaDescription:
            'Export all your Garmin watch data — steps, heart rate, GPS tracks — from Garmin Connect and chart it in your browser. Nothing leaves your device.',
        icon: 'garmin',
        parserIds: ['garmin'],
        request: 'Account → Data Management → Export Your Data',
        format: '~10,000 .fit files, in a .zip inside a .zip',
        size: 'A gigabyte or two, most of it .fit files',
        delay: 'A few hours',
        wait: 'hours',
        fills: ['positions', 'steps', 'health'],
        link: {
            href: 'https://www.garmin.com/account/datamanagement/exportdata/',
            label: 'Garmin data management',
        },
        guide: {
            intro: 'One request exports everything your watch recorded, including steps, heart rate and the GPS tracks of your activities.',
            get: 'Request it from Garmin Connect',
            steps: [
                'Sign in at <strong>garmin.com</strong> and open <strong>Account</strong> → <strong>Data Management</strong>.',
                'Choose <strong>Export Your Data</strong> and confirm.',
            ],
            wait: {
                title: 'Wait for the email',
                body: 'Garmin emails a download link, usually within a few hours.',
            },
            dropNote:
                'Drop the <code>.zip</code> without unzipping it. It holds about ten thousand <code>.fit</code> files, so reading takes a few seconds.',
        },
    },
    {
        id: 'apple-health',
        label: 'Apple Health',
        metaDescription:
            'Export all your Apple Health data from the iPhone — years of steps, and how you walk — and chart it in your browser. Nothing leaves your device.',
        icon: 'apple-health',
        parserIds: ['apple-health'],
        request: 'Health app → your picture → Export All Health Data',
        format: 'export.xml, in a .zip',
        size: 'Tens of MB zipped, hundreds once unpacked',
        delay: 'A minute or two, on the phone',
        wait: 'instant',
        madeOnPhone: true,
        fills: ['steps'],
        guide: {
            intro: 'The Health app exports everything your iPhone counted, including years of steps and how fast you walk.',
            get: 'Export it from the Health app',
            steps: [
                'Open the <strong>Health</strong> app and tap your picture in the top right.',
                'Tap <strong>Export All Health Data</strong> and confirm.',
            ],
            wait: {
                title: 'Send it to your computer',
                body: 'Preparing the file takes a minute or two. Save <code>export.zip</code> to Files, or send it with AirDrop or email.',
            },
            dropNote:
                'Drop the <code>.zip</code> without unzipping it. It unpacks to several hundred megabytes, so reading takes a little while. Data other apps wrote into Health, like Garmin Connect or Strava, is read from their own exports instead.',
        },
    },
    {
        id: 'strava',
        label: 'Strava',
        metaDescription:
            'Download your Strava archive — every activity, .gpx and .fit alike — and map all your tracks at once in your browser. Nothing leaves your device.',
        icon: 'strava',
        parserIds: ['strava'],
        request: 'Download Request, from the account page',
        format: 'One track file per activity, in a .zip',
        size: 'Tens of MB, and up if you post photos',
        delay: 'A few minutes',
        wait: 'minutes',
        fills: ['positions'],
        link: {
            href: 'https://www.strava.com/athlete/download_my_account',
            label: "Strava's archive request page",
        },
        guide: {
            intro: 'One request exports every activity you uploaded, in its original format. There are no options to set.',
            get: 'Request it from Strava',
            steps: [
                'Open the page above while signed in. It is also under <strong>Settings</strong> &rarr; <strong>My Account</strong>.',
                'Click <strong>Request Your Archive</strong>.',
            ],
            wait: {
                title: 'Wait for the email',
                body: 'Strava emails a download link, usually within a few minutes.',
            },
            dropNote:
                'If your watch also syncs to Garmin Connect, both exports contain the same activities. You can drop both. Buho counts each activity once.',
        },
    },
];

/** How this source is named in the UI, from its catalog id. */
export function sourceLabel(id: string): string {
    return CATALOG_SOURCES.find((source) => source.id === id)?.label ?? id;
}

/** The modules a source feeds, in sidebar order. */
export function modulesFilledBy(source: CatalogSource): DataModule[] {
    return DATA_MODULES.filter((module) => source.fills.includes(module.id));
}

/**
 * The exports that can fill a module, soonest to arrive first.
 *
 * The dataset's side of the relationship, and the one an empty module needs:
 * standing in front of a dataset with nothing in it, the useful question is not
 * "what is this" but "what do I go and ask for". Ordering by wait means the
 * first name offered is the one that costs the least to try.
 */
export function sourcesFilling(module: ModuleId): CatalogSource[] {
    return CATALOG_SOURCES.filter((source) => source.fills.includes(module)).sort(
        (a, b) => EXPORT_WAIT_ORDER.indexOf(a.wait) - EXPORT_WAIT_ORDER.indexOf(b.wait)
    );
}
