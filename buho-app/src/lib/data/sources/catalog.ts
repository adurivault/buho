import type { IconName } from '#lib/components/icons.ts';
import type { Network } from '#lib/types/messages.ts';
import { DATA_MODULES, type DataModule, type ModuleId } from '../modules';

/**
 * The two axes of what Buho reads, described once for the /sources page.
 *
 * Sources and modules are deliberately not the same list: one export can feed
 * two modules (a Garmin archive carries both GPS tracks and step counters) and
 * one module can be fed by several exports (positions come from Google and from
 * a watch; conversations from three different services). The matrix is the only
 * place that relationship is stated in full.
 *
 * This is documentation, not routing — the parsers in `SOURCE_PARSERS` decide
 * what is actually read. `parserIds` ties each row back to the modules doing the
 * work, and `catalog.test.ts` fails if the two drift apart.
 */

/** What one source contributes to one module — a single cell of the matrix. */
export interface Fill {
    /** Two or three words, so the matrix says something at a glance. */
    grain: string;
    /** The full answer, for the per-source detail below the matrix. */
    detail: string;
}

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
 * How to actually get this export, step by step.
 *
 * Lives on the catalog row rather than in the import dialog because the dialog
 * shows whichever guide you ask for — there is one drop zone for all eight
 * sources now, so there is no per-service dialog left to hold the prose.
 *
 * `steps`, `warning` and the `note` fields are rendered with `{@html}` for their
 * inline emphasis, so they must stay literals: never anything derived from user
 * data.
 */
export interface SourceGuide {
    /** One or two sentences on what this export is, before the steps. */
    intro: string;
    /** The few settings that decide whether the export is usable at all. */
    settings?: Array<{ label: string; value: string; note?: string }>;
    /** What to do, in order, once the link above has landed. */
    steps: string[];
    /**
     * Where the steps differ by device. Used by Google Timeline, whose export
     * moved into the phone's own settings and sits in a different place on each
     * platform; `steps` is then empty and these replace it.
     */
    platforms?: Array<{ id: string; label: string; steps: string[] }>;
    /**
     * A second, separate download the service splits its data across. Messenger
     * is the case that matters: since Meta turned on end-to-end encryption, the
     * standard export stops at the switchover date.
     */
    extra?: { title: string; body: string; href: string; label: string };
    /** The one mistake people actually make, called out after the steps. */
    warning?: string;
}

/** One export you can hand to Buho — the rows of the matrix. */
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
    /** The glyph standing for this source in the matrix. */
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
    /** What each module gets out of it. Absent means the source doesn't feed it. */
    fills: Partial<Record<ModuleId, Fill>>;
    link?: ExportLink;
    /** The one thing people get wrong, when there is one. */
    caveat?: string;
    /** How to obtain it, shown in the import dialog. */
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
        fills: {
            listening: {
                grain: 'Every play',
                detail: 'One row per play: track, artist, album, the moment it started, and how many milliseconds you actually listened before skipping. Why each track started and ended too, which no other music export records.',
            },
        },
        link: {
            href: 'https://www.spotify.com/account/privacy/',
            label: 'Spotify privacy settings',
        },
        caveat: 'Ask for the *extended* history, not the one-year "Account data". They share a page, and only the extended one goes back to the beginning.',
        guide: {
            intro: "Spotify's full play-by-play lives behind a separate request from the one-year summary, on the same privacy page.",
            settings: [
                {
                    label: 'Request',
                    value: 'Extended streaming history',
                    note: "Not 'Account data': that one covers a single year and is offered first.",
                },
            ],
            steps: [
                'Scroll to <strong>Download your data</strong> and tick <strong>Extended streaming history</strong>.',
                'Click <strong>Request data</strong>, then confirm through the email Spotify sends.',
                'Spotify emails a download link when it&rsquo;s ready, usually within a day, though Spotify reserves up to 30.',
                "Drop the <code class='text-xs'>.zip</code> here, or the folder if you already unzipped it.",
            ],
            warning:
                'The account files bundled in the same zip are read past, not parsed. Only the streaming history counts, so there&rsquo;s nothing to sort out beforehand.',
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
        fills: {
            listening: {
                grain: 'Every play',
                detail: "Track, artist, album and ISRC, with the moment and how many seconds you listened. No skip reasons, no shuffle flag and no podcasts — Deezer records none of them, so the views built on those stay Spotify's.",
            },
        },
        link: {
            href: 'https://www.deezer.com/account/personal_data',
            label: "Deezer's personal data page",
        },
        caveat: 'The history that arrives is partial: a few thousand plays with years missing from the middle, not the complete record Spotify sends. Whatever is there merges into the same table.',
        guide: {
            intro: 'Deezer sends one spreadsheet holding everything it has on you. Only the listening-history sheet inside it is read.',
            steps: [
                'Ask for your personal data: a single request, with no options to set.',
                'Deezer emails a link, usually within a few days.',
                "Drop the <code class='text-xs'>.xlsx</code> here as it came.",
            ],
            warning:
                'Expect gaps: what Deezer exports is <strong>a partial history</strong> (a few thousand plays, with whole years missing), not the complete record Spotify sends.',
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
        fills: {
            listening: {
                grain: 'Every play',
                detail: "Track, artist, album and the moment it was scrobbled — and nothing else. A scrobble records no duration, no device and no reason a track ended, so listening time and the views built on it stay Spotify's and Deezer's.",
            },
        },
        link: {
            href: 'https://mainstream.ghan.nl/export.html',
            label: "Last.fm's community export tool",
        },
        caveat: 'Scrobbles are usually a mirror of what you played elsewhere. Drop a Spotify export and a Last.fm one covering the same years and you get both: every play twice, once per service.',
        guide: {
            intro: 'Last.fm has no export of its own. The community tool above replays the public API for any username and hands you the file. No login, no API key, nothing to wait for.',
            settings: [
                {
                    label: 'Export type',
                    value: 'Scrobbles',
                },
                {
                    label: 'Format',
                    value: 'JSON',
                    note: 'Not CSV or XML: those two are offered first on the same line.',
                },
            ],
            steps: [
                'Open the tool and type your <strong>Last.fm username</strong>: your own or anyone&rsquo;s, the API is public.',
                'Pick <strong>Scrobbles</strong> as the export type and <strong>JSON</strong> as the format, then click <strong>Go</strong>.',
                'Leave the page open while it works. It fetches 200 scrobbles a page, so a long history takes a few minutes.',
                "Save the file it offers (<code class='text-xs'>scrobbles-&lt;user&gt;-&lt;number&gt;.json</code>) and drop it here.",
            ],
            warning:
                'The number in the filename is where the export stopped. Keep it: pasting it back into the tool later fetches <strong>only the scrobbles since</strong>, and you can drop that second file here alongside the first. The overlap is dropped, not doubled.',
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
        fills: {
            positions: {
                grain: 'Visits + path',
                detail: 'A coarse point every minute or so, plus the visits Google named — home, work, and the places it recognised along the way.',
            },
        },
        caveat: 'Timeline now lives on the phone, not in Takeout: the export comes out of your phone settings, so it has to travel to your computer.',
        guide: {
            intro: 'Google no longer ships Timeline with Takeout: your location history now stays on your phone, so the export has to be done from there. It takes a minute, no waiting.',
            steps: [],
            platforms: [
                {
                    id: 'android',
                    label: 'Android',
                    steps: [
                        "Open your phone's <strong>Settings</strong> app: the system settings, not the Google Maps app.",
                        'Go to <strong>Location</strong> → <strong>Location services</strong> → <strong>Timeline</strong>, and pick your Google account if it asks.',
                        'Tap <strong>Export Timeline data</strong> and choose where to save it.',
                        "You get a <code class='text-xs'>Timeline.json</code> file. Send it to your computer (Drive, email, cable), then come back here.",
                    ],
                },
                {
                    id: 'ios',
                    label: 'iPhone',
                    steps: [
                        'Open the <strong>Google Maps</strong> app and tap your <strong>profile letter</strong> in the top right.',
                        'Tap <strong>Your Timeline</strong>.',
                        'Tap the <strong>⋮</strong> icon in the top right, then <strong>Location &amp; privacy settings</strong>.',
                        'Tap <strong>Export Timeline data</strong>.',
                        "Share the file to yourself (AirDrop, email, whatever) and open it here from your computer. It's named <code class='text-xs'>Timeline.json</code> or <code class='text-xs'>location-history.json</code>.",
                    ],
                },
            ],
            warning:
                'Your phone shows these labels in its own language, and the menus move around between versions.',
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
        fills: {
            activity: {
                grain: 'Every entry',
                detail: 'One row per entry, across YouTube, Search, Maps and the rest: what it was, when, and the link it pointed at. No durations — Google records none.',
            },
        },
        link: { href: 'https://takeout.google.com/settings/takeout', label: 'Google Takeout' },
        caveat: 'The default format is HTML, which carries none of the links this needs. Switch "Activity records" to JSON before requesting.',
        guide: {
            intro: 'Takeout hands over everything Google logged, service by service. Only "My Activity" is read here, and only in its JSON form.',
            settings: [
                {
                    label: 'Format',
                    value: 'JSON',
                },
                {
                    label: 'Data',
                    value: 'My Activity',
                    note: 'Deselect everything else: the rest of a Takeout is ignored anyway.',
                },
            ],
            steps: [
                'Hit <strong>Deselect all</strong>, then scroll down and tick <strong>My Activity</strong> only.',
                'Open <strong>Multiple formats</strong> on that row and switch <strong>Activity records</strong> from HTML to <strong>JSON</strong>.',
                'Under <strong>All activity data included</strong> you can keep everything, or narrow it to YouTube, Search and Maps.',
                'Request the export. Google emails a link, usually within a few minutes to a few hours.',
            ],
            warning:
                'A Takeout zip is often larger than a browser tab can unpack. If it fails, unzip it yourself and use <strong>Choose a folder</strong>: that path has no size limit.',
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
        fills: {
            messages: {
                grain: 'Threads',
                detail: 'Conversations with their participants, and every message in them — text, reactions, and what kind of attachment it carried. The attachments themselves are never opened.',
            },
        },
        link: {
            href: 'https://www.messenger.com/secure_storage/dyi',
            label: 'Messenger secure-storage export',
        },
        caveat: 'Two downloads, not one. Each one-to-one chat was switched to end-to-end encryption on its own day (late 2023 for most accounts, through 2024 for the rest), and everything said since is only in the secure-storage export. Everything older, and every group chat, is only in the ordinary one. Drop both; Buho merges them.',
        guide: {
            intro: "Your recent one-to-one conversations are encrypted, and Meta's ordinary export form does not carry them: they come from a second, separate download, which is the one to start with.",
            settings: [
                {
                    label: 'Format',
                    value: 'JSON',
                },
                {
                    label: 'Date range',
                    value: 'All time',
                    note: 'Defaults to the last few months, which throws away most of your history.',
                },
                {
                    label: 'Media quality',
                    value: 'Low',
                },
            ],
            steps: [
                'Open the secure-storage form above and unlock it with your <strong>Messenger PIN</strong>, the code you set when your chats were encrypted.',
                'Set the three settings above, then request the download.',
                'Meta emails a link when it is ready.',
            ],
            extra: {
                title: 'Then get everything from before the encryption',
                body: 'The export above starts the day each chat was switched over &mdash; <strong>late 2023 for most accounts, through 2024 for the rest</strong>. Everything older, and every group chat, which were never encrypted, comes from Meta&rsquo;s ordinary export form instead: <strong>Some of your information</strong> &rarr; <strong>Messages</strong>, with the same three settings. That one comes back in <strong>a few minutes</strong>. Drop both exports here; Buho merges them.',
                href: 'https://accountscenter.facebook.com/info_and_permissions/dyi',
                label: "Meta's ordinary export form",
            },
            warning:
                'Large exports are split into several zip files: <strong>download all of them</strong> and drop them here together, or you&rsquo;ll be missing conversations.',
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
        fills: {
            messages: {
                grain: 'Threads',
                detail: 'The same threads, participants and messages as Messenger — the schema is identical — labelled Instagram.',
            },
        },
        link: {
            href: 'https://accountscenter.instagram.com/info_and_permissions/dyi/',
            label: "Instagram's export page",
        },
        caveat: 'Unpack an archive and drop the thread files alone and the folder names go with it, and the service then reads as "unknown".',
        guide: {
            intro: 'Same form as Messenger, on the Instagram side of the Accounts Center. The archives look identical; Buho tells them apart on its own.',
            settings: [
                {
                    label: 'Format',
                    value: 'JSON',
                },
                {
                    label: 'Date range',
                    value: 'All time',
                    note: 'Defaults to the last few months, which throws away most of your history.',
                },
                {
                    label: 'Media quality',
                    value: 'Low',
                },
            ],
            steps: [
                'Choose <strong>Download or transfer information</strong>, then pick your Instagram account.',
                'Select <strong>Some of your information</strong> and tick <strong>Messages</strong>. Anything else you tick is simply ignored, so there is no harm in taking it.',
                'Set the three settings above, then request the download.',
                "Meta emails you when it's ready, usually within a few hours.",
            ],
            warning:
                'Large exports are split into several zip files: <strong>download all of them</strong> and drop them here together, or you&rsquo;ll be missing conversations.',
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
        fills: {
            messages: {
                grain: 'One thread each',
                detail: 'One conversation per file, multi-line messages reassembled. Reactions are absent from these exports, and system notices are kept without a sender.',
            },
        },
        caveat: "No bulk export exists: conversations leave the phone one by one. You can drop all of them at once, though. Dates are in the phone's locale, so day/month order is worked out per file.",
        guide: {
            intro: 'WhatsApp has no bulk export and no web form: conversations are exported one at a time, from the phone app.',
            settings: [
                {
                    label: 'Attachments',
                    value: 'Without media',
                },
            ],
            steps: [
                'Open a conversation, tap the contact or group name at the top.',
                'Scroll down to <strong>Export chat</strong>, then choose <strong>Without media</strong>.',
                "Send the <code class='text-xs'>.txt</code> to yourself by mail, AirDrop, whatever reaches your computer.",
                'Repeat for the conversations you care about.',
            ],
            warning:
                'You can drop <strong>all the exported chats at once</strong>. No need to add them one by one.',
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
        fills: {
            positions: {
                grain: 'GPS tracks',
                detail: 'The tracks recorded during activities: a point every second or two, with speed and heading — far denser than Timeline, in the same table.',
            },
            steps: {
                grain: 'Counters',
                detail: 'The all-day step counters, kept as the recorded windows themselves rather than the daily totals Garmin computes from them.',
            },
            health: {
                grain: 'Every minute',
                detail: 'Heart rate, stress and respiration, as sampled — about one reading a minute while the watch is worn. The gaps are kept as gaps: when it was off is as much of the record as what it measured.',
            },
        },
        link: {
            href: 'https://www.garmin.com/account/datamanagement/exportdata/',
            label: 'Garmin data management',
        },
        caveat: 'Only the raw recordings are read. The daily roll-ups and performance scores shipped alongside are left alone: seeing what they were computed from is the point.',
        guide: {
            intro: 'One request gets everything the watch ever recorded: the step counters it keeps all day, and the GPS tracks of your activities, which join your location history.',
            steps: [
                'Sign in at <strong>garmin.com</strong>, then open <strong>Account</strong> → <strong>Data Management</strong>.',
                'Choose <strong>Export Your Data</strong> and confirm. Garmin emails a download link, usually within a few hours.',
                'Drop the <code>.zip</code> here as it arrived. No need to unpack it.',
            ],
            warning:
                'The archive is a zip inside a zip holding around ten thousand <code>.fit</code> files. Reading it takes a few seconds. The progress bar is not stuck.',
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
        fills: {
            positions: {
                grain: 'GPS tracks',
                detail: 'The track of every activity you ever uploaded, at the resolution it was recorded — a point a second, with heart rate and cadence where the recorder had them. It reaches back further than the watch does: Strava kept what the phone before it recorded.',
            },
        },
        link: {
            href: 'https://www.strava.com/athlete/download_my_account',
            label: "Strava's archive request page",
        },
        caveat: 'Strava hands each activity back in the format it was uploaded in, so one export holds three at once: the phone years as .gpx, the watch years as .fit. All of them are read.',
        guide: {
            intro: 'One request gets every activity you ever uploaded, each in the format it arrived in. There is nothing to configure.',
            steps: [
                'Open the page above while signed in. It is reachable from <strong>Settings</strong> &rarr; <strong>My Account</strong> too.',
                'Click <strong>Request Your Archive</strong>.',
                'Strava emails a download link, usually within a few minutes.',
                'Drop the <code>.zip</code> here as it arrived. No need to unpack it.',
            ],
            warning:
                'If a watch also feeds Garmin Connect, the same outings are in both exports. Drop both anyway: <strong>the overlap is resolved, not counted twice</strong>, minute by minute.',
        },
    },
];

/** How this source is named in the UI, from its catalog id. */
export function sourceLabel(id: string): string {
    return CATALOG_SOURCES.find((source) => source.id === id)?.label ?? id;
}

/** The modules a source feeds, in column order. */
export function modulesFilledBy(source: CatalogSource): DataModule[] {
    return DATA_MODULES.filter((module) => source.fills[module.id] !== undefined);
}

/**
 * The exports that can fill a module, soonest to arrive first.
 *
 * The other direction of the same matrix, and the one an empty module needs:
 * standing in front of a dataset with nothing in it, the useful question is not
 * "what is this" but "what do I go and ask for". Ordering by wait means the
 * first name offered is the one that costs the least to try.
 */
export function sourcesFilling(module: ModuleId): CatalogSource[] {
    return CATALOG_SOURCES.filter((source) => source.fills[module] !== undefined).sort(
        (a, b) => EXPORT_WAIT_ORDER.indexOf(a.wait) - EXPORT_WAIT_ORDER.indexOf(b.wait)
    );
}
