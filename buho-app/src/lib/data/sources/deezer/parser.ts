import type { Play } from '#lib/types/play.ts';
import { DEEZER_HISTORY_SHEET, parseDeezerHistory } from './parse';
import { readXlsxSheet } from '../../formats/xlsx/readSheet';
import type { ImportEntry, SourceParser } from '../types';

/**
 * Deezer's personal-data export — the one spreadsheet Buho reads.
 *
 * A single `.xlsx` workbook holds a dozen sheets (favourites, playlists,
 * settings); only `10_listeningHistory` carries play records, and only that one
 * is read.
 *
 * Claimed on the extension alone, like Garmin's `.fit`: an .xlsx is a zip, so
 * its head is compressed bytes that no `match` could sniff, and nothing else
 * Buho reads ships one. The sheet lookup in `parse` is where the file either
 * proves it is a Deezer export or yields nothing.
 */
export const deezerXlsxParser: SourceParser<'listening'> = {
    id: 'deezer-xlsx',
    label: 'Deezer (personal data)',
    dataset: 'listening',

    match(entry: ImportEntry): number {
        if (!/\.xlsx$/i.test(entry.name)) return 0;
        // Deezer names its download `deezer-data_<id>.xlsx`; a workbook renamed
        // by the user is still claimed, just less confidently.
        return /deezer/i.test(entry.path) ? 1 : 0.6;
    },

    async parse(entries: ImportEntry[]): Promise<Play[]> {
        const plays: Play[] = [];
        for (const entry of entries) {
            try {
                const rows = await readXlsxSheet(await entry.bytes(), DEEZER_HISTORY_SHEET);
                // No such sheet: a spreadsheet that isn't a Deezer export. It was
                // claimed on its extension, so this is the expected way out.
                if (!rows) continue;
                plays.push(...parseDeezerHistory(rows));
            } catch {
                // A damaged workbook shouldn't sink a drop that also holds a
                // perfectly good Spotify export.
            }
        }
        return plays;
    },
};
