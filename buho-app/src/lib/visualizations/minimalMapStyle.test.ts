import { describe, it, expect } from 'vitest';
import { toMinimalStyle } from './minimalMapStyle';

const ROAD = '#8b95a9';

const baseStyle = {
    version: 8,
    layers: [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill', paint: { 'fill-color': '#123' } },
        { id: 'building', type: 'fill', 'source-layer': 'building' },
        { id: 'waterway', type: 'line', 'source-layer': 'waterway', paint: { 'line-color': '#111' } },
        { id: 'highway_minor', type: 'line', 'source-layer': 'transportation', paint: { 'line-color': '#181818' } },
        { id: 'highway_major_inner', type: 'line', 'source-layer': 'transportation', paint: { 'line-color': '#070707' } },
        { id: 'highway_major_casing', type: 'line', 'source-layer': 'transportation', paint: { 'line-color': '#3c3c3c', 'line-dasharray': [1, 1] } },
        { id: 'highway_motorway_subtle', type: 'line', 'source-layer': 'transportation', paint: { 'line-color': '#181818' } },
        { id: 'highway_path', type: 'line', 'source-layer': 'transportation', paint: { 'line-dasharray': [2, 2] } },
        { id: 'railway', type: 'line', 'source-layer': 'transportation' },
        { id: 'boundary_country', type: 'line', 'source-layer': 'boundary' },
        { id: 'place_city', type: 'symbol' },
        { id: 'highway_name_motorway', type: 'symbol' },
    ],
};

function ids(s: typeof baseStyle) {
    return toMinimalStyle(s, { roadColor: ROAD }).layers.map((l) => l.id);
}

describe('toMinimalStyle', () => {
    it('removes every label (streets, places, countries…)', () => {
        const out = ids(baseStyle);
        expect(out).not.toContain('place_city');
        expect(out).not.toContain('highway_name_motorway');
    });

    it('removes buildings and boundary lines', () => {
        const out = ids(baseStyle);
        expect(out).not.toContain('building');
        expect(out).not.toContain('boundary_country');
    });

    it('drops road clutter (casings, subtle underlays, rails, paths)', () => {
        const out = ids(baseStyle);
        expect(out).not.toContain('highway_major_casing');
        expect(out).not.toContain('highway_motorway_subtle');
        expect(out).not.toContain('highway_path');
        expect(out).not.toContain('railway');
    });

    it('keeps the plain road fills, recoloured flat and un-dashed', () => {
        const layers = toMinimalStyle(baseStyle, { roadColor: ROAD }).layers;
        const minor = layers.find((l) => l.id === 'highway_minor');
        const major = layers.find((l) => l.id === 'highway_major_inner');
        expect(minor?.paint?.['line-color']).toBe(ROAD);
        expect(major?.paint?.['line-color']).toBe(ROAD);
        expect(minor?.paint?.['line-dasharray']).toBeUndefined();
    });

    it('leaves non-road layers (background, water, waterway) untouched', () => {
        const layers = toMinimalStyle(baseStyle, { roadColor: ROAD }).layers;
        expect(layers.find((l) => l.id === 'background')).toBeTruthy();
        expect(layers.find((l) => l.id === 'water')?.paint?.['fill-color']).toBe('#123');
        // waterway is a line but not a road → colour preserved.
        expect(layers.find((l) => l.id === 'waterway')?.paint?.['line-color']).toBe('#111');
    });

    it('does not mutate the input', () => {
        const before = JSON.parse(JSON.stringify(baseStyle));
        toMinimalStyle(baseStyle, { roadColor: ROAD });
        expect(baseStyle).toEqual(before);
    });
});
