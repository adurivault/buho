import JSZip from 'jszip';

/**
 * Just enough of the XLSX format to read one named sheet as rows of strings.
 *
 * Deezer is the only source that ships a spreadsheet, and a full spreadsheet
 * library is a large dependency for one sheet of nine text columns. An .xlsx is
 * a zip of XML, and JSZip is already here for every other archive — so the
 * reader is the parts that file actually uses:
 *
 *   workbook.xml          sheet names → relationship ids
 *   _rels/workbook.xml.rels   relationship ids → worksheet paths
 *   worksheets/sheetN.xml     the cells
 *
 * Everything is returned as text. Deezer writes every cell as an inline string,
 * including its numbers and dates, so there is nothing to coerce and no date
 * serials to decode — and a column that arrives as `"-1"` or `"None"` is the
 * parser's problem, not this file's.
 */

/** Cells of one row, left to right, gaps filled in. */
export type SheetRow = string[];

/**
 * XML entities Excel writes inside `<t>`. `&amp;` is unescaped last so that a
 * literal `&amp;lt;` in a song title survives as `&lt;` rather than becoming `<`.
 */
function unescapeXml(text: string): string {
    if (!text.includes('&')) return text;
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&amp;/g, '&');
}

/** "BC12" → 54. Column letters are base-26 with A = 1. */
export function columnIndex(ref: string): number {
    const letters = /^([A-Z]+)/.exec(ref)?.[1];
    if (!letters) return 0;
    let index = 0;
    for (const char of letters) {
        index = index * 26 + (char.charCodeAt(0) - 64);
    }
    return index - 1;
}

/** Concatenated `<t>` runs of one element — a cell's text is split across them. */
function textRuns(xml: string): string {
    let out = '';
    for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
        out += unescapeXml(match[1]);
    }
    return out;
}

/**
 * The shared string table, when there is one.
 *
 * Excel deduplicates strings into this table and cells reference them by index;
 * Deezer's writer inlines them instead. Both are legal, so both are handled —
 * the file that arrives is whatever Deezer's exporter emits that week.
 */
function parseSharedStrings(xml: string): string[] {
    return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
}

/** One cell's text, whichever way its value is stored. */
function cellText(cell: string, shared: string[]): string {
    const type = /\st="([^"]+)"/.exec(cell)?.[1];

    // Inline string: the text sits in an <is> child, same shape as a shared one.
    if (type === 'inlineStr') return textRuns(cell);

    const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cell)?.[1];
    if (value === undefined) return '';

    // Shared string: <v> holds an index into the table.
    if (type === 's') return shared[Number(value)] ?? '';
    // A formula's cached string result.
    if (type === 'str') return unescapeXml(value);
    // Numbers and booleans arrive as their literal digits, which is all the
    // callers want — no styles are consulted, so a date-formatted number would
    // come back as its serial. Deezer writes dates as text, so none appear.
    return unescapeXml(value);
}

/**
 * Rows of one sheet, addressed by the name shown on its tab.
 *
 * Cells carry their own `r` reference, so a row with an empty trailing cell
 * simply omits it and a blank cell in the middle is skipped entirely. Placing
 * each cell at its own column index — rather than pushing in document order —
 * is what keeps a row aligned with its header when a value is missing.
 *
 * @returns the sheet's rows, or null if the workbook has no such tab.
 */
export async function readXlsxSheet(
    bytes: Uint8Array,
    sheetName: string
): Promise<SheetRow[] | null> {
    const zip = await JSZip.loadAsync(bytes);

    const workbook = await zip.file('xl/workbook.xml')?.async('string');
    if (!workbook) return null;

    const sheet = [...workbook.matchAll(/<sheet\s[^>]*>/g)].find(
        (match) => unescapeXml(/\sname="([^"]*)"/.exec(match[0])?.[1] ?? '') === sheetName
    )?.[0];
    if (!sheet) return null;

    const relationId = /\sr:id="([^"]+)"/.exec(sheet)?.[1];
    if (!relationId) return null;

    const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
    if (!rels) return null;

    // Attribute order is not fixed — Deezer writes Target before Id — so the
    // relationship is found by id and its Target read out of the same element.
    const relation = [...rels.matchAll(/<Relationship\s[^>]*\/>/g)].find(
        (match) => /\sId="([^"]+)"/.exec(match[0])?.[1] === relationId
    )?.[0];
    if (!relation) return null;

    const target = /\sTarget="([^"]+)"/.exec(relation)?.[1];
    if (!target) return null;

    // Targets come either absolute ("/xl/worksheets/sheet8.xml") or relative to
    // the workbook's own folder ("worksheets/sheet8.xml").
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;

    const sheetXml = await zip.file(path)?.async('string');
    if (!sheetXml) return null;

    const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
    const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

    const rows: SheetRow[] = [];
    for (const rowMatch of sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
        const row: SheetRow = [];
        // Self-closing `<c r="D2"/>` is an empty cell that still holds a column.
        for (const cellMatch of rowMatch[1].matchAll(/<c(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/c>)/g)) {
            const cell = cellMatch[0];
            const ref = /\sr="([A-Z]+\d+)"/.exec(cell)?.[1];
            const index = ref ? columnIndex(ref) : row.length;
            while (row.length < index) row.push('');
            row[index] = cellText(cell, shared);
        }
        rows.push(row);
    }
    return rows;
}
