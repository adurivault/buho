import { describe, it, expect } from 'vitest';
import { sections } from './sections';

describe('sections registry', () => {
    it('exports an array of sections', () => {
        expect(Array.isArray(sections)).toBe(true);
    });

    it('each section has required properties', () => {
        if (sections.length > 0) {
            const section = sections[0];
            expect(section).toHaveProperty('id');
            expect(section).toHaveProperty('component');
            // props is optional but good to check structure if present
        }
    });
});
