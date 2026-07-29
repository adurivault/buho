import { trackOnce } from "$lib/analytics";

/**
 * Reports the first time a guide section is actually read — how far down the
 * narration people get, which is otherwise invisible in a single-page scroll.
 *
 * `use:sectionView={"speed-distribution"}` on the section wrapper. The id is a
 * literal from the code, never anything derived from the user's data. Fires at
 * most once per page load (cf. trackOnce), so scrolling back up costs nothing.
 */
export function sectionView(node: HTMLElement, id: string) {
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries.some((e) => e.isIntersecting)) return;
            trackOnce("section-view", id, { section: id });
            observer.disconnect();
        },
        // Half the section on screen: reached and read, not merely scrolled past.
        { threshold: 0.5 }
    );
    observer.observe(node);

    return {
        destroy() {
            observer.disconnect();
        }
    };
}
