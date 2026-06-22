<script lang="ts">
    // Minimal scaffold for the DB-ingestion step: upload a Google Timeline
    // export and confirm it lands in `google_maps_segments`. The real explorer
    // (constellation + dimensions) replaces this body in the next step.
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { query } from "$lib/data/db";

    let fileInput: HTMLInputElement;

    interface Count {
        value: string | null;
        n: number;
    }
    let total = $state<number | null>(null);
    let bySegment = $state<Count[]>([]);
    let byActivity = $state<Count[]>([]);
    let bySemantic = $state<Count[]>([]);
    let range = $state<{ min: string; max: string } | null>(null);

    async function loadStats() {
        const totalRows = await query<{ n: bigint }>(
            "SELECT COUNT(*) AS n FROM google_maps_segments",
        );
        total = Number(totalRows[0]?.n ?? 0);

        const seg = await query<{ value: string | null; n: bigint }>(
            "SELECT segment_type AS value, COUNT(*) AS n FROM google_maps_segments GROUP BY 1 ORDER BY n DESC",
        );
        bySegment = seg.map((r) => ({ value: r.value, n: Number(r.n) }));

        const act = await query<{ value: string | null; n: bigint }>(
            "SELECT activity_type AS value, COUNT(*) AS n FROM google_maps_segments WHERE segment_type = 'moving' GROUP BY 1 ORDER BY n DESC",
        );
        byActivity = act.map((r) => ({ value: r.value, n: Number(r.n) }));

        const sem = await query<{ value: string | null; n: bigint }>(
            "SELECT semantic_type AS value, COUNT(*) AS n FROM google_maps_segments WHERE segment_type = 'stationary' GROUP BY 1 ORDER BY n DESC",
        );
        bySemantic = sem.map((r) => ({ value: r.value, n: Number(r.n) }));

        const r = await query<{ min: string; max: string }>(
            "SELECT MIN(timestamp)::VARCHAR AS min, MAX(timestamp)::VARCHAR AS max FROM google_maps_segments",
        );
        range = r[0] ? { min: r[0].min, max: r[0].max } : null;
    }

    async function handleFileChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        if (files && files.length > 0) {
            await dataStore.handleLocationFilesUpload(files);
            if (!dataStore.error) await loadStats();
        }
        target.value = "";
    }
</script>

<div class="space-y-4 p-6">
    <h1 class="text-2xl font-bold">Google Maps Explorer</h1>

    <input
        type="file"
        accept=".json,.zip"
        multiple
        bind:this={fileInput}
        onchange={handleFileChange}
    />

    {#if dataStore.loading}
        <p class="text-muted-foreground">{dataStore.loading.message}</p>
    {/if}
    {#if dataStore.error}
        <p class="text-destructive-foreground">
            Error: {dataStore.error.message}
        </p>
    {/if}

    {#if total !== null}
        <div class="space-y-3 text-sm">
            <p><strong>{total.toLocaleString()}</strong> segments</p>
            {#if range}
                <p class="text-muted-foreground">{range.min} → {range.max}</p>
            {/if}

            <div>
                <p class="font-semibold">By segment type</p>
                {#each bySegment as row}
                    <div>{row.value ?? "—"}: {row.n.toLocaleString()}</div>
                {/each}
            </div>

            <div>
                <p class="font-semibold">By activity type (moving)</p>
                {#each byActivity as row}
                    <div>{row.value ?? "—"}: {row.n.toLocaleString()}</div>
                {/each}
            </div>

            <div>
                <p class="font-semibold">By semantic type (stationary)</p>
                {#each bySemantic as row}
                    <div>{row.value ?? "—"}: {row.n.toLocaleString()}</div>
                {/each}
            </div>
        </div>
    {/if}
</div>
