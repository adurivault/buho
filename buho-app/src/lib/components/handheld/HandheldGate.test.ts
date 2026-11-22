import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { createRawSnippet } from 'svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import HandheldGate from './HandheldGate.svelte';
import { moduleById } from '#lib/data/modules.ts';

const nav = vi.hoisted(() => ({ url: new URL('http://localhost/steps/explore') }));
const device = vi.hoisted(() => ({ showcase: true, exploreAnyway: vi.fn() }));

vi.mock('$app/state', () => ({
    page: {
        get url() {
            return nav.url;
        },
    },
}));

vi.mock('#lib/stores/deviceStore.svelte.ts', () => ({
    deviceStore: {
        get showcase() {
            return device.showcase;
        },
    },
    exploreAnyway: device.exploreAnyway,
}));

const page = createRawSnippet(() => ({ render: () => '<p>The page itself</p>' }));

beforeEach(() => {
    nav.url = new URL('http://localhost/steps/explore');
    device.showcase = true;
    device.exploreAnyway.mockClear();
});

describe('HandheldGate', () => {
    test('puts the poster where the Explorer would be on a phone', () => {
        render(HandheldGate, { props: { module: moduleById('steps'), children: page } });

        expect(screen.getByRole('heading', { name: /The steps explorer/i })).toBeInTheDocument();
        expect(screen.queryByText('The page itself')).not.toBeInTheDocument();
    });

    test('lets every other page of the module through', () => {
        nav.url = new URL('http://localhost/listening/guide');
        render(HandheldGate, { props: { module: moduleById('listening'), children: page } });

        expect(screen.getByText('The page itself')).toBeInTheDocument();
    });

    test('shows the Explorer itself off a phone', () => {
        device.showcase = false;
        render(HandheldGate, { props: { module: moduleById('steps'), children: page } });

        expect(screen.getByText('The page itself')).toBeInTheDocument();
    });

    // The guide is read by scrolling, so it is the way on for a module that has one.
    test('points to the guide where the module has one', () => {
        nav.url = new URL('http://localhost/messages/explore');
        render(HandheldGate, { props: { module: moduleById('messages'), children: page } });

        expect(
            screen.getByRole('link', { name: /Read the messages guide instead/i })
        ).toHaveAttribute('href', '/messages/guide');
    });

    test('offers no guide where there is none', () => {
        render(HandheldGate, { props: { module: moduleById('steps'), children: page } });

        expect(screen.queryByRole('link', { name: /guide instead/i })).not.toBeInTheDocument();
    });

    test('opens the Explorer anyway on request', async () => {
        render(HandheldGate, { props: { module: moduleById('steps'), children: page } });

        await fireEvent.click(screen.getByRole('button', { name: /Explore anyway/i }));

        expect(device.exploreAnyway).toHaveBeenCalled();
    });
});
