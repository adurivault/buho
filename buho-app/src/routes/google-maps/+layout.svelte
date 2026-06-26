<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { dataStore } from "$lib/stores/dataStore.svelte";

	let { children } = $props();

	let fileInput: HTMLInputElement;

	const onMaps = $derived(dataStore.source === "google-maps");

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

		<nav class="header-center">
			<a
				href={resolve("/google-maps/explore")}
				class="nav-link"
				class:active={page.url.pathname.startsWith(
					resolve("/google-maps/explore"),
				)}>Explore</a
			>
			<span class="nav-link disabled" aria-disabled="true" title="Coming soon"
				>Guide</span
			>
		</nav>

		<div class="header-right">
			<input
				type="file"
				accept=".json,.zip"
				multiple
				class="hidden"
				bind:this={fileInput}
				onchange={handleFileChange}
			/>
			<div class="upload-pill">
				{#if dataStore.loading}
					<span class="dot loading"></span>
					<span class="muted">{dataStore.loading.message}</span>
				{:else if onMaps}
					<span class="dot ok"></span>
					<span class="ok-text">Your data</span>
					<button
						class="upload-btn"
						type="button"
						onclick={() => fileInput?.click()}
						disabled={!!dataStore.loading}>Replace</button
					>
				{:else}
					<button
						class="upload-btn primary"
						type="button"
						onclick={() => fileInput?.click()}
						disabled={!!dataStore.loading}>Upload Timeline</button
					>
				{/if}
			</div>
		</div>
	</header>

	{#if dataStore.error}
		<div class="error-bar" role="alert">
			{dataStore.error.message}
		</div>
	{/if}

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
		display: flex;
		gap: 0.25rem;
	}

	.header-right {
		justify-self: end;
	}

	.nav-link {
		padding: 0.3rem 0.7rem;
		border-radius: 0.5rem;
		font-size: 0.85rem;
		color: hsl(var(--muted-foreground));
		text-decoration: none;
		transition:
			color 0.15s,
			background-color 0.15s;
	}

	a.nav-link:hover {
		color: hsl(var(--foreground));
		background: hsl(var(--accent));
	}

	.nav-link.active {
		color: hsl(var(--foreground));
		background: hsl(var(--accent));
	}

	.nav-link.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.hidden {
		display: none;
	}

	.error-bar {
		flex: none;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		color: hsl(var(--destructive-foreground, 0 0% 100%));
		background: hsl(var(--destructive) / 0.15);
		border-bottom: 1px solid hsl(var(--destructive) / 0.4);
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
