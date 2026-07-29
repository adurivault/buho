<script lang="ts">
	import { resolve } from "$app/paths";
	import { dataStore } from "$lib/stores/dataStore.svelte";
	import SourceNav from "$lib/components/SourceNav.svelte";
	import ImportStatus from "$lib/components/ImportStatus.svelte";
	import GoogleMapsImportDialog from "$lib/components/GoogleMapsImportDialog.svelte";
	import { trackEvent } from "$lib/analytics";

	let { children } = $props();

	let fileInput: HTMLInputElement;
	let dialogOpen = $state(false);

	function openImportDialog() {
		trackEvent("import-open", { source: "google-maps", replace: onMaps });
		dialogOpen = true;
	}

	const onMaps = $derived(dataStore.source === "google-maps");

	const tabs = [
		{ label: "Explore", href: resolve("/google-maps/explore") },
		{ label: "Other", href: resolve("/google-maps/guide") },
	];

	async function handleFileChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = target.files;
		if (files && files.length > 0) {
			await dataStore.handleLocationFilesUpload(files);
		}
		target.value = "";
	}
</script>

<div class="maps-shell">
	<header class="maps-header">
		<div class="header-left">
			<span class="source-title">Google Maps</span>
		</div>

		<div class="header-center">
			<SourceNav tabs={tabs} ariaLabel="Google Maps views" />
		</div>

		<div class="header-right">
			<input
				type="file"
				accept=".json,.zip"
				multiple
				class="hidden"
				bind:this={fileInput}
				onchange={handleFileChange}
			/>
			<GoogleMapsImportDialog
				bind:open={dialogOpen}
				onClose={() => (dialogOpen = false)}
				onPickFile={() => fileInput?.click()}
			/>
			<div class="upload-pill">
				{#if dataStore.loading}
					<span class="dot loading"></span>
					<span class="muted">Loading…</span>
				{:else if onMaps}
					<span class="dot ok"></span>
					<span class="ok-text">Your data</span>
					<button
						class="upload-btn"
						type="button"
						onclick={openImportDialog}
						disabled={!!dataStore.loading}>Replace</button
					>
				{:else}
					<button
						class="upload-btn primary"
						type="button"
						onclick={openImportDialog}
						disabled={!!dataStore.loading}>Import Timeline</button
					>
				{/if}
			</div>
		</div>
	</header>

	<ImportStatus />

	<div class="maps-content">
		{@render children()}
	</div>
</div>

<style>
	.maps-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.maps-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.maps-header {
		flex: none;
		z-index: 30;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 1rem;
		min-height: 52px;
		padding: 0.375rem 1rem;
		border-bottom: 1px solid hsl(var(--border));
		background: hsl(var(--background) / 0.85);
		backdrop-filter: blur(8px);
	}

	.header-left {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.source-title {
		flex: 0 0 auto;
		font-weight: 600;
		color: hsl(var(--foreground));
	}

	.header-center {
		justify-self: center;
		/* Maps keeps its own brand hue on the shared segmented toggle. */
		--source-accent: var(--accent-maps);
	}

	.header-right {
		justify-self: end;
	}

	.hidden {
		display: none;
	}

	.upload-pill {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid hsl(var(--border));
		border-radius: 999px;
		padding: 0.25rem 0.35rem 0.25rem 0.75rem;
		background: hsl(var(--secondary) / 0.4);
		font-size: 0.85rem;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex: none;
	}
	.dot.loading {
		background: hsl(var(--primary));
		animation: pulse 1.2s ease-in-out infinite;
	}
	.dot.ok {
		background: #2dd4a8;
	}

	.muted {
		color: hsl(var(--muted-foreground));
	}
	.ok-text {
		font-weight: 500;
		color: #2dd4a8;
	}

	.upload-btn {
		border: none;
		border-radius: 999px;
		padding: 0.2rem 0.7rem;
		font-size: 0.8rem;
		cursor: pointer;
		color: hsl(var(--muted-foreground));
		background: transparent;
		transition:
			color 0.15s,
			background-color 0.15s;
	}
	.upload-btn:hover {
		color: hsl(var(--foreground));
		background: hsl(var(--accent));
	}
	.upload-btn.primary {
		color: hsl(var(--primary-foreground));
		background: hsl(var(--primary));
		font-weight: 600;
	}
	.upload-btn.primary:hover {
		opacity: 0.9;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	@media (max-width: 767px) {
		.maps-header {
			grid-template-columns: auto 1fr;
			gap: 0.5rem;
		}
		.source-title {
			display: none;
		}
		.header-center {
			justify-self: start;
		}
	}
</style>
