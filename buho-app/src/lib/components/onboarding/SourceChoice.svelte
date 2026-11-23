<script lang="ts">
    import { resolve } from '$app/paths';
    import Icon from '#lib/components/Icon.svelte';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import { moduleById } from '#lib/data/modules.ts';
    import type { CatalogSource } from '#lib/data/sources/catalog.ts';
    import { funnelLabel, quickStartSource, sourcesByWait } from '#lib/onboarding/funnel.ts';

    /**
     * Step one: one recommendation, and everything else underneath it.
     *
     * This has been three shapes. Three cards and six lines of small print read
     * as "your service is not supported". Then nine equal entries, which is a
     * catalogue — accurate, and no help at all to somebody who has never
     * requested an export and cannot tell which of the nine is cheap to try.
     *
     * The thing a first-time visitor actually needs to know is not what the
     * options are, it is **which one costs nothing to attempt**. So WhatsApp is
     * the only offer above the fold, with the reason spelled out, and the rest
     * are one flat list sorted by how long they take to answer. Nobody is
     * blocked; the slow ones are one click away and say what the wait is.
     *
     * Deliberately uncoloured. Tinting each entry with the accent of the module
     * it feeds put a green box next to Deezer and a red one next to Instagram —
     * colours that are neither the service's nor meaningful here. Accents mean
     * "this is the Listening dataset", and this page is not about datasets.
     */
    interface Props {
        onPick: (source: CatalogSource) => void;
        onSkip: () => void;
    }

    let { onPick, onSkip }: Props = $props();

    const lead = quickStartSource();
    const rest = sourcesByWait().filter((source) => source.id !== lead.id);

    /** The dataset it feeds, named the way the sidebar and the hub name it. */
    function fills(source: CatalogSource): string {
        return source.fills.map((id) => moduleById(id).label).join(' · ');
    }
</script>

<button class="lead" onclick={() => onPick(lead)}>
    <span class="tag">Start here</span>
    <span class="glyph">
        <NetworkIcon network="whatsapp" size={26} />
    </span>
    <span class="lead-name">{lead.label}</span>
    <span class="lead-why">
        Export is a button inside the app, on one conversation at a time. Nothing to request and
        nobody to wait for: about two minutes, and one long thread with somebody you have known for
        years is already enough to see something.
    </span>
    <span class="lead-cta">Show me how →</span>
</button>

<p class="rest-lede">
    <strong>Or ask another service.</strong> Most of these are a request rather than a download: you ask,
    the service takes its own time, and the file is waiting when you come back. Nothing stops you doing
    both: send a request now, then carry on with WhatsApp while it is being prepared.
</p>

<ul class="others">
    {#each rest as source (source.id)}
        <li>
            <button class="row" onclick={() => onPick(source)}>
                <span class="glyph small">
                    {#if source.network}
                        <NetworkIcon network={source.network} size={18} />
                    {:else}
                        <Icon name={source.icon} size={18} />
                    {/if}
                </span>
                <span class="who">
                    <span class="name">{funnelLabel(source)}</span>
                    <span class="fills">{fills(source)}</span>
                </span>
                <span class="wait">{source.delay}</span>
            </button>
        </li>
    {/each}
</ul>

<p class="reference">
    <a href={resolve('sources')}>What each export contains, in detail →</a>
</p>

<p class="skip">
    <button onclick={() => onSkip()}>I already have my export →</button>
</p>

<style>
    /* The whole page is one colour. See the component comment: per-source
       accents were borrowed from the module the export feeds, so they said
       nothing true about the service they sat next to. */
    .lead {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: start;
        gap: 0.35rem 1rem;
        width: 100%;
        max-width: 40rem;
        padding: 1.5rem;
        border: 1px solid hsl(var(--foreground) / 0.25);
        border-radius: var(--radius-xl);
        background: hsl(var(--card));
        text-align: left;
        cursor: pointer;
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }

    .lead:hover {
        border-color: hsl(var(--foreground) / 0.5);
        background: hsl(var(--secondary) / 0.5);
    }

    .tag {
        grid-column: 1 / -1;
        margin-bottom: 0.5rem;
        font-size: var(--text-label);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: hsl(var(--muted-foreground));
    }

    .glyph {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: var(--radius-pill);
        border: 1px solid hsl(var(--border));
        color: hsl(var(--foreground));
        flex: none;
    }

    .glyph.small {
        width: 1.9rem;
        height: 1.9rem;
        color: hsl(var(--muted-foreground));
    }

    .lead-name {
        align-self: center;
        font-size: var(--text-subheading);
        font-weight: 600;
    }

    .lead-why,
    .lead-cta {
        grid-column: 2;
    }

    .lead-why {
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .lead-cta {
        margin-top: 0.6rem;
        font-size: var(--text-body);
        font-weight: 600;
    }

    .rest-lede {
        max-width: 40rem;
        margin: 2.5rem 0 1rem;
        font-size: var(--text-body);
        line-height: 1.65;
        color: hsl(var(--muted-foreground));
    }

    .rest-lede strong {
        font-weight: 600;
        color: hsl(var(--foreground));
    }

    .others {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
        gap: 0.5rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    /* Same information as the card, a quarter of the height: these are the ones
       you are being told exist, not the one you are being pointed at. */
    .row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 0.7rem;
        width: 100%;
        height: 100%;
        padding: 0.7rem 0.85rem;
        border: 1px solid hsl(var(--border));
        border-radius: 0.7rem;
        background: hsl(var(--card));
        text-align: left;
        cursor: pointer;
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }

    .row:hover {
        border-color: hsl(var(--foreground) / 0.35);
        background: hsl(var(--secondary) / 0.5);
    }

    .row:hover .glyph.small {
        color: hsl(var(--foreground));
    }

    .who {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .name {
        font-size: var(--text-body);
        font-weight: 600;
    }

    .fills {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .wait {
        flex: none;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .reference {
        margin: 2rem 0 0;
        font-size: var(--text-small);
    }

    .reference a,
    .skip button {
        color: hsl(var(--muted-foreground));
        text-decoration: underline;
        text-underline-offset: 4px;
        transition: color 0.15s;
    }

    .reference a:hover,
    .skip button:hover {
        color: hsl(var(--foreground));
    }

    .skip {
        margin: 1rem 0 0;
    }

    .skip button {
        font-size: var(--text-body);
        cursor: pointer;
    }
</style>
