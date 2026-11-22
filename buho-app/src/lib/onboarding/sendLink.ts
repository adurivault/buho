/**
 * Sending the page you are on to yourself, to open on a computer.
 *
 * There is no server in this, and there must not be one: Buho never learns an
 * email address. The phone's own share sheet does the sending — the person
 * picks Mail, Messages, AirDrop or a note to self, and it leaves from their own
 * account. Where there is no share sheet the address goes on the clipboard, and
 * where there is no clipboard either, a `mailto:` link opens their mail app with
 * the message already written. Only the address travels, never anything read
 * from their files.
 */

export type SendOutcome = 'shared' | 'copied' | 'mail' | 'dismissed';

/** The parts of `navigator` this needs, so a test can hand in its own. */
export interface SendDevice {
    share?: (data: ShareData) => Promise<void>;
    clipboard?: { writeText?: (text: string) => Promise<void> };
}

/** A message to oneself: a subject, and the address as the whole body. */
export function mailtoHref(url: string, subject: string): string {
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(url)}`;
}

/**
 * Hands `url` to the best route this device has, and says which one it took.
 *
 * A dismissed share sheet is an answer, not a failure: the person saw their
 * options and closed them, so nothing else is tried behind their back. Any
 * other refusal (no permission, a payload the platform will not take) falls
 * through to the next route.
 */
export async function sendLink(
    url: string,
    title: string,
    device: SendDevice = typeof navigator === 'undefined' ? {} : navigator,
    openMail: (href: string) => void = (href) => {
        window.location.href = href;
    }
): Promise<SendOutcome> {
    if (typeof device.share === 'function') {
        try {
            await device.share({ title, url });
            return 'shared';
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return 'dismissed';
        }
    }

    if (typeof device.clipboard?.writeText === 'function') {
        try {
            await device.clipboard.writeText(url);
            return 'copied';
        } catch {
            // No permission for it; the mail app is still there.
        }
    }

    openMail(mailtoHref(url, title));
    return 'mail';
}
