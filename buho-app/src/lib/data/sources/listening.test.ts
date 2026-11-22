import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readDrop, routeEntries } from './registry';
import { deezerXlsxParser } from './deezer/parser';
import { lastfmJsonParser } from './lastfm/parser';
import { spotifyJsonParser } from './spotify/parser';
import type { ImportEntry } from './types';

/**
 * Routing and parsing for the three music services, which is where "they
 * cohabit" either holds or doesn't: one drop has to be able to carry all of
 * them, and no parser may claim another's files. Spotify and Last.fm are the
 * pair that matters — both ship a JSON array of plays, so only the shape of an
 * entry separates them.
 */

function textEntry(path: string, content: string): ImportEntry {
    return {
        path,
        name: path.split('/').pop() ?? path,
        peek: async (length) => content.slice(0, length),
        text: async () => content,
        bytes: async () => new TextEncoder().encode(content),
    };
}

function binaryEntry(path: string, bytes: Uint8Array): ImportEntry {
    return {
        path,
        name: path.split('/').pop() ?? path,
        binary: true,
        peek: async () => '',
        text: async () => '',
        bytes: async () => bytes,
    };
}

const SPOTIFY_PLAY = {
    ts: '2023-01-01T20:00:00Z',
    platform: 'ios',
    ms_played: 180000,
    conn_country: 'FR',
    ip_addr: '127.0.0.1',
    master_metadata_track_name: 'On A Train',
    master_metadata_album_artist_name: 'Yuksek',
    master_metadata_album_album_name: 'On A Train EP',
    spotify_track_uri: 'spotify:track:abc',
    episode_name: null,
    episode_show_name: null,
    spotify_episode_uri: null,
    reason_start: 'clickrow',
    reason_end: 'trackdone',
    shuffle: false,
    skipped: false,
    offline: false,
    offline_timestamp: null,
    incognito_mode: false,
};

/** The account file that sits next to the history in the same export. */
const SPOTIFY_ACCOUNT = JSON.stringify({
    identifier: 'x',
    email: 'someone@example.com',
    country: 'FR',
});

/** A Deezer workbook carrying only the sheet the parser reads. */
async function deezerWorkbook(rows: string[][]): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file(
        'xl/workbook.xml',
        '<workbook><sheets><sheet name="10_listeningHistory" sheetId="1" r:id="rId1"/></sheets></workbook>'
    );
    zip.file(
        'xl/_rels/workbook.xml.rels',
        '<Relationships><Relationship Type="worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1"/></Relationships>'
    );
    const body = rows
        .map(
            (cells, r) =>
                `<row r="${r + 1}">${cells
                    .map(
                        (v, c) =>
                            `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`
                    )
                    .join('')}</row>`
        )
        .join('');
    zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${body}</sheetData></worksheet>`);
    return zip.generateAsync({ type: 'uint8array' });
}

const DEEZER_HEADER = [
    'Song Title',
    'Artist',
    'ISRC',
    'Album Title',
    'IP Address',
    'Listening Time',
    'Platform Name',
    'Platform Model',
    'Date',
];
const DEEZER_ROW = [
    'Ne me quitte pas',
    'Jacques Brel',
    'FRZ111600556',
    'La Valse',
    '198.51.100.23',
    '199',
    'electron',
    '',
    '2026-05-28 23:41:54',
];

/** One scrobble, as the community exporter saves it. */
const LASTFM_SCROBBLE = {
    artist: { mbid: '6bc23bdf', '#text': 'Ben Mazué' },
    streamable: '0',
    image: [{ size: 'small', '#text': 'https://lastfm-img.example/34s/x.jpg' }],
    mbid: '7e6a9462',
    album: { mbid: '61d3d9b1', '#text': 'Paradis' },
    name: 'Quand je marche',
    url: 'https://www.last.fm/music/Ben+Mazue/_/Quand+je+marche',
    date: { uts: '1781422755', '#text': '14 Jun 2026, 07:39' },
};

/** The exporter writes one array per API page, nested in an outer array. */
const LASTFM_EXPORT = JSON.stringify([[LASTFM_SCROBBLE]]);

describe('routing listening exports', () => {
    it('claims a Spotify history file on the shape of its first entry', async () => {
        const { matched } = await routeEntries([
            textEntry('Streaming_History_Audio_2023.json', JSON.stringify([SPOTIFY_PLAY])),
        ]);

        expect([...matched.keys()]).toEqual([spotifyJsonParser]);
    });

    it('leaves the account files of the same export alone', async () => {
        // They are JSON in the same zip, so only the entry shape separates them.
        const { matched, unmatched } = await routeEntries([
            textEntry('Userdata.json', SPOTIFY_ACCOUNT),
        ]);

        expect(matched.size).toBe(0);
        expect(unmatched).toHaveLength(1);
    });

    it('claims a scrobbles export for Last.fm', async () => {
        const { matched } = await routeEntries([
            textEntry('scrobbles-someone-1781422755.json', LASTFM_EXPORT),
        ]);

        expect([...matched.keys()]).toEqual([lastfmJsonParser]);
    });

    it('keeps the two JSON histories apart', async () => {
        // Both are arrays of plays with a .json name, so the entry shape is the
        // only thing separating them — and a wrong verdict here is silent.
        const { matched } = await routeEntries([
            textEntry('Streaming_History_Audio_2023.json', JSON.stringify([SPOTIFY_PLAY])),
            textEntry('scrobbles-someone-1781422755.json', LASTFM_EXPORT),
        ]);

        expect(matched.get(spotifyJsonParser)?.map((e) => e.name)).toEqual([
            'Streaming_History_Audio_2023.json',
        ]);
        expect(matched.get(lastfmJsonParser)?.map((e) => e.name)).toEqual([
            'scrobbles-someone-1781422755.json',
        ]);
    });

    it('claims a scrobbles export the user renamed', async () => {
        // The filename carries a resume marker people rename away, so it only
        // raises the score — the head has to be enough on its own.
        const { matched } = await routeEntries([textEntry('lastfm.json', LASTFM_EXPORT)]);

        expect([...matched.keys()]).toEqual([lastfmJsonParser]);
    });

    it('reads a scrobble into a play carrying no duration', async () => {
        const { plays } = await readDrop([textEntry('scrobbles-x-1.json', LASTFM_EXPORT)]);

        expect(plays).toHaveLength(1);
        expect(plays[0].source).toBe('lastfm');
        expect(plays[0].trackName).toBe('Quand je marche');
        expect(plays[0].msPlayed).toBeNull();
    });

    it('merges two overlapping scrobble files into one ordered history', async () => {
        // The exporter can resume from a previous download, so this is the
        // normal way a second file arrives.
        const older = JSON.stringify([
            [{ ...LASTFM_SCROBBLE, name: 'Older', date: { uts: '1533060090' } }],
        ]);

        const { plays } = await readDrop([
            textEntry('scrobbles-x-1781422755.json', LASTFM_EXPORT),
            textEntry('scrobbles-x-1533060090.json', older),
        ]);

        expect(plays.map((p) => p.trackName)).toEqual(['Older', 'Quand je marche']);
    });

    it('claims an .xlsx for Deezer', async () => {
        const { matched } = await routeEntries([
            binaryEntry('deezer-data_17240005.xlsx', await deezerWorkbook([DEEZER_HEADER])),
        ]);

        expect([...matched.keys()]).toEqual([deezerXlsxParser]);
    });

    it('reads all three music exports dropped together', async () => {
        const { plays, unrecognisedFiles } = await readDrop([
            textEntry('Streaming_History_Audio_2023.json', JSON.stringify([SPOTIFY_PLAY])),
            binaryEntry(
                'deezer-data_17240005.xlsx',
                await deezerWorkbook([DEEZER_HEADER, DEEZER_ROW])
            ),
            textEntry('scrobbles-someone-1781422755.json', LASTFM_EXPORT),
        ]);

        expect(plays).toHaveLength(3);
        expect(plays.map((p) => p.source).sort()).toEqual(['deezer', 'lastfm', 'spotify']);
        expect(unrecognisedFiles).toBe(0);
    });

    it('yields nothing for a spreadsheet without the history sheet', async () => {
        // Claimed on its extension — there is nothing in a zip's head to sniff —
        // so rejecting it is the sheet lookup's job, and it must not throw.
        const zip = new JSZip();
        zip.file('xl/workbook.xml', '<workbook><sheets></sheets></workbook>');
        const bytes = await zip.generateAsync({ type: 'uint8array' });

        const { plays } = await readDrop([binaryEntry('budget.xlsx', bytes)]);
        expect(plays).toEqual([]);
    });

    it('survives a damaged workbook without sinking the Spotify export beside it', async () => {
        const { plays } = await readDrop([
            textEntry('Streaming_History_Audio_2023.json', JSON.stringify([SPOTIFY_PLAY])),
            binaryEntry('broken.xlsx', new Uint8Array([1, 2, 3])),
        ]);

        expect(plays).toHaveLength(1);
        expect(plays[0].source).toBe('spotify');
    });

    it('skips entries that are not valid JSON without losing the rest', async () => {
        const { plays } = await readDrop([
            textEntry('Streaming_History_Audio_0.json', '[{"ts": "2023'),
            textEntry('Streaming_History_Audio_1.json', JSON.stringify([SPOTIFY_PLAY])),
        ]);

        expect(plays).toHaveLength(1);
    });
});
