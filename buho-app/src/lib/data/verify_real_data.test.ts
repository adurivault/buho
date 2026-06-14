import { describe, it, expect } from 'vitest';
import { parseSpotifyData } from './parseSpotify';
import * as fs from 'fs';
import * as path from 'path';

describe('Real Data Verification', () => {
    it('should parse real spotify data file without error', () => {
        // Path to the real data file (adjusting relative to project root or using absolute path)
        const dataPath = '/Users/augustinrf/Programming/buho/data/spotify/Streaming_History_Audio_2024-2025_9.json';

        console.log(`Reading file: ${dataPath}`);
        const rawContent = fs.readFileSync(dataPath, 'utf-8');
        const jsonData = JSON.parse(rawContent);

        console.log(`Entries found: ${jsonData.length}`);

        const result = parseSpotifyData(jsonData);

        console.log(`Parsed entries: ${result.length}`);
        expect(result.length).toBe(jsonData.length);

        // Validation check for platform normalization
        const unknownPlatforms = result.filter(r => r.platformClean === 'Other');
        if (unknownPlatforms.length > 0) {
            console.log(`Warning: ${unknownPlatforms.length} entries have 'Other' platform.`);
            console.log('Sample raw platforms:', unknownPlatforms.slice(0, 5).map(r => r.platform));
        }
    });
});
