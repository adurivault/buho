/**
 * Resolving `var(--token)` for renderers that live outside the document.
 *
 * Every chart in the app paints in theme tokens — `hsl(var(--foreground))`,
 * `hsl(var(--border))` — which the browser resolves against `:root`. An SVG
 * rasterised through an `<img>` is loaded as its *own* document: it never sees
 * our stylesheet, so those references resolve to nothing and the chart comes
 * out black-on-black. The fix is to substitute the tokens into the markup
 * before handing it over, which is what this does.
 *
 * Deliberately a string rewrite rather than a walk over computed styles: the
 * substitution runs once per exported frame, and reading `getComputedStyle` on
 * every node of a busy chart is an order of magnitude slower than a regex-free
 * scan over the serialised text.
 */

/** Looks tokens up on the live tree, caching each one for the whole run. */
export function createTokenResolver(
    root: Element = document.documentElement
): (name: string) => string {
    const style = getComputedStyle(root);
    const cache = new Map<string, string>();

    return (name: string) => {
        const hit = cache.get(name);
        if (hit !== undefined) return hit;
        const value = style.getPropertyValue(name).trim();
        cache.set(name, value);
        return value;
    };
}

/**
 * Replaces every `var(--token[, fallback])` in `text` with its live value.
 *
 * Hand-scanned rather than matched with a regex because the fallback may hold
 * another `var()` — `hsl(var(--popover, var(--background)))` is real code in
 * this repo — and a regex cannot balance parentheses. Unknown tokens collapse
 * to their fallback, or to the empty string, which is what a browser does too.
 */
export function resolveCssVars(
    text: string,
    resolve: (name: string) => string = createTokenResolver()
): string {
    let out = '';
    let i = 0;

    while (i < text.length) {
        const start = text.indexOf('var(', i);
        if (start === -1) {
            out += text.slice(i);
            break;
        }

        out += text.slice(i, start);

        // Walk to the matching ')', so a nested var() in the fallback stays whole.
        let depth = 0;
        let end = start + 3;
        for (; end < text.length; end++) {
            if (text[end] === '(') depth++;
            else if (text[end] === ')' && --depth === 0) break;
        }
        if (end >= text.length) {
            // Unbalanced: emit the rest verbatim rather than losing it.
            out += text.slice(start);
            break;
        }

        const inner = text.slice(start + 4, end);
        const comma = splitAtTopLevelComma(inner);
        const name = comma.head.trim();
        const value = name.startsWith('--') ? resolve(name) : '';

        if (value) out += value;
        // The fallback is trimmed: `var(--a, gold)` is written with a space after
        // the comma for readability, and keeping it would push a stray space into
        // a colour string that has to parse.
        else if (comma.tail !== null) out += resolveCssVars(comma.tail.trim(), resolve);

        i = end + 1;
    }

    return out;
}

/** Splits `--a, hsl(var(--b), 1)` at its own comma, ignoring nested ones. */
function splitAtTopLevelComma(text: string): { head: string; tail: string | null } {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            return { head: text.slice(0, i), tail: text.slice(i + 1) };
        }
    }
    return { head: text, tail: null };
}
