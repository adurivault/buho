import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { columnIndex, readXlsxSheet } from './readSheet';

/**
 * Workbooks are built here rather than committed as binary fixtures: the point
 * of each test is one structural choice Excel writers differ on — inline vs
 * shared strings, absolute vs relative relationship targets, a skipped cell —
 * and a checked-in .xlsx would hide exactly those bytes.
 */
interface WorkbookOptions {
    sheetName?: string;
    /** Written as `Target="…"` in the rels; both forms occur in the wild. */
    target?: string;
    sharedStrings?: string[];
    /** Raw `<row>` markup, so a test can write malformed or sparse rows. */
    rows: string[];
}

async function workbook({
    sheetName = 'Sheet1',
    target = '/xl/worksheets/sheet1.xml',
    sharedStrings,
    rows,
}: WorkbookOptions): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file(
        'xl/workbook.xml',
        `<workbook><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    );
    // Attribute order deliberately puts Target before Id, as Deezer's writer does.
    zip.file(
        'xl/_rels/workbook.xml.rels',
        `<Relationships><Relationship Type="worksheet" Target="${target}" Id="rId1"/></Relationships>`
    );
    if (sharedStrings) {
        zip.file(
            'xl/sharedStrings.xml',
            `<sst>${sharedStrings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`
        );
    }
    // A relative target is resolved against the workbook's own folder, so that
    // is where the member actually lives in the archive.
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    zip.file(path, `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`);
    return zip.generateAsync({ type: 'uint8array' });
}

/** A row of inline-string cells, the way Deezer writes every value. */
const inlineRow = (index: number, values: string[]) =>
    `<row r="${index}">${values
        .map(
            (v, i) =>
                `<c r="${String.fromCharCode(65 + i)}${index}" t="inlineStr"><is><t>${v}</t></is></c>`
        )
        .join('')}</row>`;

describe('columnIndex', () => {
    it('reads column letters as base-26', () => {
        expect(columnIndex('A1')).toBe(0);
        expect(columnIndex('I2')).toBe(8);
        expect(columnIndex('Z10')).toBe(25);
        expect(columnIndex('AA1')).toBe(26);
        expect(columnIndex('BC12')).toBe(54);
    });
});

describe('readXlsxSheet', () => {
    it('reads inline strings, the form Deezer ships', async () => {
        const bytes = await workbook({
            sheetName: '10_listeningHistory',
            rows: [inlineRow(1, ['Song Title', 'Artist']), inlineRow(2, ['On A Train', 'Yuksek'])],
        });

        expect(await readXlsxSheet(bytes, '10_listeningHistory')).toEqual([
            ['Song Title', 'Artist'],
            ['On A Train', 'Yuksek'],
        ]);
    });

    it('resolves shared strings by index', async () => {
        const bytes = await workbook({
            sharedStrings: ['Title', 'Yuksek'],
            rows: ['<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'],
        });

        expect(await readXlsxSheet(bytes, 'Sheet1')).toEqual([['Title', 'Yuksek']]);
    });

    it('keeps a value in its own column when an earlier cell is absent', async () => {
        // A blank cell is omitted entirely rather than written empty, so pushing
        // cells in document order would shift every later value left by one.
        const bytes = await workbook({
            rows: [
                '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="D1" t="inlineStr"><is><t>y</t></is></c></row>',
            ],
        });

        expect(await readXlsxSheet(bytes, 'Sheet1')).toEqual([['x', '', '', 'y']]);
    });

    it('unescapes XML entities, including an ampersand in a title', async () => {
        const bytes = await workbook({
            rows: [inlineRow(1, ['Girls At (feat. Nicki Minaj &amp; Flo Rida)', '&lt;3'])],
        });

        expect(await readXlsxSheet(bytes, 'Sheet1')).toEqual([
            ['Girls At (feat. Nicki Minaj & Flo Rida)', '<3'],
        ]);
    });

    it('does not turn an escaped entity into markup', async () => {
        // "&amp;lt;" is the literal text "&lt;", not a less-than sign: unescaping
        // ampersands last is what keeps the two apart.
        const bytes = await workbook({ rows: [inlineRow(1, ['&amp;lt;'])] });

        expect(await readXlsxSheet(bytes, 'Sheet1')).toEqual([['&lt;']]);
    });

    it('follows a relationship target relative to the workbook folder', async () => {
        const bytes = await workbook({
            target: 'worksheets/sheet1.xml',
            rows: [inlineRow(1, ['ok'])],
        });

        expect(await readXlsxSheet(bytes, 'Sheet1')).toEqual([['ok']]);
    });

    it('returns null for a sheet the workbook does not have', async () => {
        // How the Deezer parser rejects a spreadsheet it claimed on extension
        // alone but that turns out to be someone's budget.
        const bytes = await workbook({ rows: [inlineRow(1, ['ok'])] });

        expect(await readXlsxSheet(bytes, '10_listeningHistory')).toBeNull();
    });

    it('returns null rather than throwing on a zip that is no workbook', async () => {
        const zip = new JSZip();
        zip.file('hello.txt', 'not a workbook');
        const bytes = await zip.generateAsync({ type: 'uint8array' });

        expect(await readXlsxSheet(bytes, 'Sheet1')).toBeNull();
    });
});
