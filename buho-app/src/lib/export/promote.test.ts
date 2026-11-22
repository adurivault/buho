import { describe, expect, it } from 'vitest';
import { APP_PITCH, APP_URL, SHARE_CHANNELS } from './promote';

const byId = (id: string) => SHARE_CHANNELS.find((c) => c.id === id)!;

describe('SHARE_CHANNELS', () => {
    it('carries the address on every channel', () => {
        for (const channel of SHARE_CHANNELS) {
            expect(channel.href(APP_PITCH, APP_URL)).toContain(encodeURIComponent(APP_URL));
        }
    });

    it('encodes the message rather than pasting it raw', () => {
        // The pitch has an em dash and a comma in it; unencoded they truncate the
        // query at the first one a target chooses to treat as a separator.
        for (const channel of SHARE_CHANNELS) {
            expect(channel.href(APP_PITCH, APP_URL)).not.toContain(' ');
            expect(channel.href(APP_PITCH, APP_URL)).not.toContain('—');
        }
    });

    it('puts the address inside the text for WhatsApp, its only field', () => {
        const href = byId('whatsapp').href('hello', APP_URL);
        expect(href).toBe(`https://wa.me/?text=${encodeURIComponent(`hello ${APP_URL}`)}`);
    });

    it('keeps text and url apart where the target has both', () => {
        expect(byId('x').href('hello', APP_URL)).toContain('text=hello&url=');
        expect(byId('telegram').href('hello', APP_URL)).toContain('&text=hello');
    });

    it('opens a mail draft rather than a web page', () => {
        expect(byId('email').href('hello', APP_URL).startsWith('mailto:?')).toBe(true);
    });

    it('names no chart, since the link cannot point at one', () => {
        for (const channel of SHARE_CHANNELS) {
            expect(channel.href(APP_PITCH, APP_URL)).toContain('buho-app.com');
        }
        expect(APP_PITCH).not.toMatch(/\bmy (listening|messages|artists)\b/);
    });
});
