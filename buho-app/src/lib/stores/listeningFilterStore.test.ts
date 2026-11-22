import { beforeEach, describe, expect, it } from 'vitest';
import { listeningFilterStore } from './listeningFilterStore.svelte';

describe('listeningFilterStore', () => {
    beforeEach(() => {
        listeningFilterStore.reset();
    });

    it('setBounds initializes range to full bounds', () => {
        listeningFilterStore.setBounds({
            minDate: '2024-01-01',
            maxDate: '2024-01-31',
        });

        expect(listeningFilterStore.startDate).toBe('2024-01-01');
        expect(listeningFilterStore.endDate).toBe('2024-01-31');
    });

    it('setBounds with resetRange forces a full-range reset', () => {
        listeningFilterStore.setBounds({
            minDate: '2024-01-01',
            maxDate: '2024-01-31',
        });
        listeningFilterStore.setRange('2024-01-10', '2024-01-20');

        listeningFilterStore.setBounds(
            { minDate: '2025-03-01', maxDate: '2025-03-31' },
            { resetRange: true }
        );

        expect(listeningFilterStore.startDate).toBe('2025-03-01');
        expect(listeningFilterStore.endDate).toBe('2025-03-31');
    });

    it('setRange clamps inside bounds', () => {
        listeningFilterStore.setBounds({
            minDate: '2024-01-01',
            maxDate: '2024-01-31',
        });

        listeningFilterStore.setRange('2023-12-01', '2024-02-10');

        expect(listeningFilterStore.startDate).toBe('2024-01-01');
        expect(listeningFilterStore.endDate).toBe('2024-01-31');
    });

    it('setRange never leaves start after end', () => {
        listeningFilterStore.setBounds({
            minDate: '2024-01-01',
            maxDate: '2024-01-31',
        });

        listeningFilterStore.setRange('2024-01-20', '2024-01-10');

        expect(listeningFilterStore.startDate).toBe('2024-01-10');
        expect(listeningFilterStore.endDate).toBe('2024-01-20');
    });
});
