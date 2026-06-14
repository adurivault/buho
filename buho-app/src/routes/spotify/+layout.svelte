<script lang="ts">
	import { onMount } from "svelte";
	import { base } from "$app/paths";
	import { dataStore } from "$lib/stores/dataStore.svelte";
	import { initDuckDB, isReady, insertSpotifyPlays } from "$lib/data/db";
	import { parseSpotifyData } from "$lib/data/parseSpotify";
	import type { RawSpotifyEntry } from "$lib/types/spotify";
	import FileUpload from "$lib/components/FileUpload.svelte";
	import SpotifyNav from "$lib/components/SpotifyNav.svelte";

	let { children } = $props();

	onMount(async () => {
		/**
		 * DATA PERSISTENCE PATTERN (Story 2.5):
		 * This check ensures data is loaded only once per browser session.
		 * When navigating between Guide and Explorer child routes, this layout
		 * component persists (SvelteKit does not remount parent layouts on
		 * child route changes). Combined with the singleton dataStore, this
		 * prevents re-fetching demo data on every navigation.
		 */
		if (dataStore.source === "spotify" || dataStore.loading) return; // Data already loaded or loading - skip initialization

		try {
			// Initialize DB if needed
			if (!isReady()) {
				await initDuckDB();
			}

			dataStore.setLoading(true);

			// Fetch demo data with correct base path
			const res = await fetch(`${base}/demo/spotify.json`);
			if (!res.ok)
				throw new Error(
					`Failed to load demo data: ${res.status} ${res.statusText}`,
				);

			const rawData: RawSpotifyEntry[] = await res.json();
			const plays = parseSpotifyData(rawData);

			await insertSpotifyPlays(plays);
			dataStore.loadDemoData("spotify");
			console.log("Demo data loaded successfully");
		} catch (e: any) {
			console.error("Failed to load demo data", e);
			dataStore.setError(e.message || "Unknown error loading demo data");
		} finally {
			dataStore.setLoading(false);
		}
	});
</script>

<div class="spotify-shell">
	<header class="spotify-header">
		<div class="header-left">
			<span class="source-title">Spotify</span>
		</div>
		<div class="header-center">
			<SpotifyNav />
		</div>
		<div class="header-right">
			<FileUpload />
		</div>
	</header>

	<div class="spotify-content">
		{@render children()}
	</div>
</div>

<style>
	/* Colonne plein écran : header fixe en haut, contenu qui prend le reste.
	   L'Explore s'y cale pile (pas de scroll) ; le Guide y défile (overflow). */
	.spotify-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.spotify-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.spotify-header {
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
		gap: 0.75rem;
		min-width: 0;
	}

	.source-title {
		flex: 0 0 auto;
		font-weight: 600;
		color: var(--accent-spotify, #1db954);
	}

	.header-center {
		justify-self: center;
	}

	.header-right {
		justify-self: end;
	}

	@media (max-width: 767px) {
		.spotify-header {
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
