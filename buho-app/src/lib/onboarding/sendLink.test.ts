import { describe, expect, it, vi } from 'vitest';
import { mailtoHref, sendLink } from './sendLink';

const URL_TO_SEND = 'https://buho-app.com/?step=drop&source=whatsapp';

describe('sendLink', () => {
    it('uses the share sheet when there is one', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        const writeText = vi.fn();

        const outcome = await sendLink(URL_TO_SEND, 'Buho', { share, clipboard: { writeText } });

        expect(outcome).toBe('shared');
        expect(share).toHaveBeenCalledWith({ title: 'Buho', url: URL_TO_SEND });
        expect(writeText).not.toHaveBeenCalled();
    });

    // Closing the sheet is a choice: nothing else is tried behind the
    // person's back.
    it('stops when the share sheet is dismissed', async () => {
        const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
        const writeText = vi.fn();
        const openMail = vi.fn();

        const outcome = await sendLink(
            URL_TO_SEND,
            'Buho',
            { share, clipboard: { writeText } },
            openMail
        );

        expect(outcome).toBe('dismissed');
        expect(writeText).not.toHaveBeenCalled();
        expect(openMail).not.toHaveBeenCalled();
    });

    it('copies the address when the share sheet refuses it', async () => {
        const share = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'));
        const writeText = vi.fn().mockResolvedValue(undefined);

        const outcome = await sendLink(URL_TO_SEND, 'Buho', { share, clipboard: { writeText } });

        expect(outcome).toBe('copied');
        expect(writeText).toHaveBeenCalledWith(URL_TO_SEND);
    });

    it('copies the address where there is no share sheet', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);

        expect(await sendLink(URL_TO_SEND, 'Buho', { clipboard: { writeText } })).toBe('copied');
    });

    it('opens the mail app as the last resort', async () => {
        const openMail = vi.fn();

        const outcome = await sendLink(URL_TO_SEND, 'Buho', {}, openMail);

        expect(outcome).toBe('mail');
        expect(openMail).toHaveBeenCalledWith(mailtoHref(URL_TO_SEND, 'Buho'));
    });
});

describe('mailtoHref', () => {
    it('leaves the recipient empty and carries only the address', () => {
        const href = mailtoHref(URL_TO_SEND, 'Buho — open on a computer');

        expect(href.startsWith('mailto:?')).toBe(true);
        const params = new URLSearchParams(href.slice('mailto:?'.length));
        expect(params.get('subject')).toBe('Buho — open on a computer');
        expect(params.get('body')).toBe(URL_TO_SEND);
    });
});
