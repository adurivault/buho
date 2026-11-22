<script lang="ts">
    import { Search, X } from '@lucide/svelte';
    import InfoHint from '#lib/components/InfoHint.svelte';

    /**
     * The search field an Explorer puts above its charts.
     *
     * The query itself lives in the page's filter store, like every other
     * selection, so "Clear all filters" empties this field too and the field
     * never disagrees with what the charts show. What this component keeps is
     * the draft being typed: it only commits after a short pause, because every
     * commit re-marks the whole export.
     *
     * What the search found is told by the charts, and its terms by the legend
     * on the constellation (`SearchLegend`) — the chart they color.
     */
    interface Props {
        /** The committed query, as held by the filter store. */
        value: string;
        onChange: (raw: string) => void;
        placeholder: string;
        /** Called when the field takes focus: the moment to get the index ready. */
        onWarm?: () => void;
    }

    let { value, onChange, placeholder, onWarm }: Props = $props();

    /** Long enough to skip the keystrokes of one word, short enough to feel live. */
    const DEBOUNCE_MS = 160;

    let input = $state<HTMLInputElement | null>(null);
    let draft = $state('');
    let lastCommitted: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Follow the store when something else changes it ("Clear all filters", a
    // term removed from the legend), but never overwrite a draft that simply
    // has not been committed yet.
    $effect(() => {
        const committed = value;
        if (committed === lastCommitted) return;
        lastCommitted = committed;
        if (timer) clearTimeout(timer);
        timer = null;
        draft = committed;
    });

    function commit(next: string) {
        if (timer) clearTimeout(timer);
        timer = null;
        if (next === lastCommitted) return;
        lastCommitted = next;
        onChange(next);
    }

    function onInput(event: Event) {
        draft = (event.currentTarget as HTMLInputElement).value;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => commit(draft), DEBOUNCE_MS);
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            commit(draft);
        } else if (event.key === 'Escape') {
            if (draft) {
                draft = '';
                commit('');
            } else {
                input?.blur();
            }
        }
    }

    function clear() {
        draft = '';
        commit('');
        input?.focus();
    }

    /**
     * "/" jumps to the field from anywhere on the page, the way it does on most
     * sites with one search box — unless the key is being typed somewhere.
     */
    function onWindowKeydown(event: KeyboardEvent) {
        if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target as HTMLElement | null;
        if (
            target &&
            (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        ) {
            return;
        }
        event.preventDefault();
        input?.focus();
        input?.select();
    }

    const HINT =
        'Finds words where they start, ignoring case and accents: "restau" finds "Restaurant", "ca" finds "Ça". ' +
        'Put a word in quotes for that word only. Separate terms with commas to compare them — each gets its own color. ' +
        'Press / to jump here. The search runs in this tab and is never sent anywhere.';
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="search" role="search">
    <label class="field" class:filled={draft !== ''}>
        <Search size={15} strokeWidth={2} aria-hidden="true" />
        <input
            bind:this={input}
            type="search"
            value={draft}
            {placeholder}
            aria-label={placeholder}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            oninput={onInput}
            onkeydown={onKeydown}
            onfocus={() => onWarm?.()}
        />
        {#if draft}
            <button type="button" class="clear" onclick={clear} aria-label="Clear the search">
                <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
        {:else}
            <kbd aria-hidden="true">/</kbd>
        {/if}
    </label>

    <InfoHint text={HINT} label="How the search works" />
</div>

<style>
    .search {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .field {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        width: clamp(12rem, 22vw, 20rem);
        height: 2.1rem;
        padding: 0 0.55rem 0 0.65rem;
        border: 1px solid hsl(var(--border-strong));
        border-radius: var(--radius-md);
        background: hsl(var(--card));
        color: hsl(var(--muted-foreground));
        cursor: text;
        transition:
            border-color 0.16s ease,
            box-shadow 0.16s ease;
    }

    .field:focus-within,
    .field.filled {
        border-color: color-mix(in srgb, var(--module-accent) 70%, transparent);
    }

    .field:focus-within {
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--module-accent) 16%, transparent);
    }

    input {
        flex: 1;
        min-width: 0;
        height: 100%;
        border: none;
        outline: none;
        background: transparent;
        color: hsl(var(--foreground));
        font: inherit;
        font-size: var(--text-body);
    }

    input::placeholder {
        color: hsl(var(--muted-foreground));
    }

    /* The field brings its own clear button; the browser's would be a second. */
    input::-webkit-search-cancel-button {
        display: none;
    }

    kbd {
        flex: none;
        font-family: var(--font-mono);
        font-size: var(--text-label);
        line-height: 1;
        padding: 0.18rem 0.38rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-sm);
        color: hsl(var(--muted-foreground));
    }

    .clear {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: hsl(var(--muted-foreground));
        cursor: pointer;
        padding: 0.15rem;
        border-radius: var(--radius-pill);
    }

    .clear:hover {
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--foreground)) 10%, transparent);
    }

    /* Takes whatever the row leaves it, beside the clear button. */
    @media (max-width: 767px) {
        .search {
            flex: 1;
        }

        .field {
            flex: 1;
            width: auto;
            min-width: 0;
        }
    }
</style>
