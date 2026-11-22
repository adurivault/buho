/**
 * Rendered on the server, unlike the rest of the app.
 *
 * The root layout turns SSR off because every dataset route is a DuckDB session
 * that only exists in the tab. The funnel is not: it is words, and it is the
 * page every crawler lands on first. Left as a shell it was indexed as an empty
 * document — and the crawlers behind the assistants people now ask for tools
 * like this one don't run scripts at all, so it was indexed as nothing.
 */
export const ssr = true;
