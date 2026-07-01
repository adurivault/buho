<script lang="ts">
	import { onMount } from "svelte";
	import "../app.css";
	import favicon from "$lib/assets/favicon.svg";
	import AppSidebar from "$lib/components/AppSidebar.svelte";
	import { initDuckDB } from "$lib/data/db";
	import { uiStore, setDbInitializing } from "$lib/stores/uiStore.svelte";
	import { errorStore, setError } from "$lib/stores/errorStore.svelte";
	import { initErrorTracking } from "$lib/analytics";
	import { initTheme } from "$lib/stores/themeStore.svelte";

	let { children } = $props();

	onMount(async () => {
		initTheme();
		initErrorTracking();
		try {
			setDbInitializing(true);
			await initDuckDB();
		} catch (error) {
			console.error("Failed to initialize DuckDB:", error);
			setError({
				source: "duckdb",
				message:
					error instanceof Error
						? error.message
						: "Unknown error initializing database",
			});
		} finally {
			setDbInitializing(false);
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-container">
	<AppSidebar />
	<main class="main-content">
		{#if errorStore.error}
			<div class="error-banner">
				<strong>Error:</strong>
				{errorStore.error.message}
			</div>
		{/if}

		{#if uiStore.dbInitializing}
			<div class="loading-overlay">Initializing data engine...</div>
		{/if}

		{@render children()}
	</main>
</div>

<style>
	.app-container {
		display: flex;
		height: 100vh; /* Ensure full height */
	}

	.main-content {
		flex-grow: 1;
		position: relative; /* For overlay */
		overflow-y: auto;
	}

	.error-banner {
		background-color: hsl(var(--destructive));
		color: hsl(var(--destructive-foreground));
		padding: 1rem;
		margin: 1rem;
		border-radius: var(--radius);
		border: 1px solid hsl(var(--destructive) / 0.5);
	}

	.loading-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		background: hsl(var(--background) / 0.9);
		padding: 0.5rem;
		text-align: center;
		font-size: 0.875rem;
		color: hsl(var(--muted-foreground));
		z-index: 10;
		border-bottom: 1px solid hsl(var(--border));
	}
</style>
