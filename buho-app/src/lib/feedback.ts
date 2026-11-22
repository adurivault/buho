/**
 * Where feedback goes.
 *
 * A mailto rather than a form: a form would need a server to post to, and Buho
 * has none — that is the whole point of it. The reader's own mail client is the
 * only channel that doesn't quietly break the promise on the front page.
 *
 * Spelled once, because it appears on the landing page, the FAQ and the error dialog.
 */
export const FEEDBACK_EMAIL = 'feedback.buho@gmail.com';

/** The address with a subject, so replies arrive already sorted. */
export const FEEDBACK_HREF = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Buho feedback')}`;
