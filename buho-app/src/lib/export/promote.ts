/**
 * Two ways of passing a chart on that are not a downloaded file.
 *
 * **The clipboard** is the one that quietly matters most on a desktop. Firefox
 * has no Web Share API at all, and pasting into WhatsApp Web or Slack is what
 * people do there anyway — with their own words around it, which beat any
 * message written here.
 *
 * **The link** goes to the app, not to a chart, and it is honest about that.
 * Nothing is persisted, so no URL could ever point at somebody's own listening;
 * every channel below carries text and a URL and nothing else. They sit *after*
 * an export in the menu, beside the picture the person just made, because that
 * is the moment someone wants to show it — and the picture itself already
 * carries the address, painted into its corner.
 */

export const APP_URL = 'https://buho-app.com';

/**
 * What goes out with the link.
 *
 * A description, not a testimonial. Whoever sends this is putting it in their
 * own message, and words written on their behalf — first person especially —
 * read as something they did not say. This states what the app is and leaves
 * the endorsement to them.
 */
export const APP_PITCH =
    'Buho — visualise your Spotify, Google, WhatsApp and Garmin exports, entirely in your browser.';

export type ShareChannel = {
    id: 'whatsapp' | 'x' | 'telegram' | 'email';
    label: string;
    /** Where the button points. Opened in a new tab, never navigated to. */
    href(message: string, url: string): string;
};

const encode = encodeURIComponent;

export const SHARE_CHANNELS: ShareChannel[] = [
    {
        id: 'whatsapp',
        label: 'WhatsApp',
        // wa.me carries one field, so the address has to ride inside the text.
        href: (message, url) => `https://wa.me/?text=${encode(`${message} ${url}`)}`,
    },
    {
        id: 'x',
        label: 'X',
        href: (message, url) =>
            `https://x.com/intent/post?text=${encode(message)}&url=${encode(url)}`,
    },
    {
        id: 'telegram',
        label: 'Telegram',
        href: (message, url) => `https://t.me/share/url?url=${encode(url)}&text=${encode(message)}`,
    },
    {
        id: 'email',
        // "Mail", not "Email": the four labels sit on one row of the menu, and
        // the longer word is what pushes this one onto a second line.
        label: 'Mail',
        href: (message, url) =>
            `mailto:?subject=${encode('Buho')}&body=${encode(`${message}\n\n${url}`)}`,
    },
];

/* --------------------------------------------------------------- clipboard */

export function canCopyImage(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        typeof ClipboardItem !== 'undefined' &&
        typeof navigator.clipboard?.write === 'function'
    );
}

/**
 * Puts a still on the clipboard.
 *
 * Takes the capture **unresolved**, and that is the whole trick: Safari only
 * honours a clipboard write registered inside the click that asked for it, and
 * rendering a chart takes far longer than a click lasts. Handing over the
 * pending blob lets the write be registered now and settle later — so nothing
 * may be awaited before calling this, or the gesture is already spent.
 *
 * A browser that will not take a promise gets the blob the ordinary way, which
 * works everywhere except Safari, which is the one that needed the promise.
 */
export async function copyImageToClipboard(pending: Promise<Blob>): Promise<void> {
    if (!canCopyImage()) throw new Error('This browser cannot copy an image.');

    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]);
    } catch {
        const blob = await pending;
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    }
}

export function canCopyText(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
}

export async function copyText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
}
