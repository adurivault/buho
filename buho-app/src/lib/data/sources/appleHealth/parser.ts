import type { GaitReading, StepPacket } from '#lib/types/steps.ts';
import type { ImportEntry, MonitoringPayload, SourceParser } from '../types';
import { createScanner, forEachLine, rowsFromScan } from './records';

/** The head of the file, enough to hold the DTD's version comment. */
const SNIFF_BYTES = 4096;

/**
 * Apple Health's "Export All Health Data": a zip holding `export.xml`, and next
 * to it `export_cda.xml` — the same vital signs restated as a medical record,
 * left alone.
 *
 * Read for the steps module: the phone's step counts, years of them before any
 * watch, and the gait readings it takes while you walk.
 * Everything else in the file is either another app's copy of its own data (see
 * `records.ts`) or not read yet.
 */
export const appleHealthParser: SourceParser<'monitoring'> = {
    id: 'apple-health',
    label: 'Apple Health',
    dataset: 'monitoring',

    match(entry: ImportEntry): number {
        // Routed on the path: the file is far too large to inflate twice, once
        // to sniff it and once to read it.
        return entry.name === 'export.xml' ? 1 : 0;
    },

    async parse(entries: ImportEntry[]): Promise<MonitoringPayload> {
        const steps: StepPacket[] = [];
        const gait: GaitReading[] = [];
        const readerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        for (const entry of entries) {
            const bytes = await entry.bytes();
            // Another export's file of the same name: nothing to read.
            const head = new TextDecoder().decode(bytes.subarray(0, SNIFF_BYTES));
            if (!head.includes('<!DOCTYPE HealthData')) continue;

            const scanner = createScanner();
            await forEachLine(bytes, scanner.line);
            const rows = rowsFromScan(scanner.result(), readerZone);
            for (const packet of rows.steps) steps.push(packet);
            for (const reading of rows.gait) gait.push(reading);
        }

        return { positions: [], steps, gait, health: [] };
    },
};
