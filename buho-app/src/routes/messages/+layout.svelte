<script lang="ts">
	import { resolve } from "$app/paths";
	import { dataStore } from "$lib/stores/dataStore.svelte";
	import SourceNav from "$lib/components/SourceNav.svelte";
	import ImportStatus from "$lib/components/ImportStatus.svelte";
	import MessagesImportDialog from "$lib/components/MessagesImportDialog.svelte";
	import { NETWORK_LABELS } from "$lib/types/messages";
	import { trackEvent } from "$lib/analytics";

	let { children } = $props();

	let fileInput: HTMLInputElement;
	let folderInput: HTMLInputElement;
	let dialogOpen = $state(false);
	/** Set by the dialog: the next pick replaces everything instead of adding. */
	let replaceNext = $state(false);

	function openImportDialog() {
		trackEvent("import-open", { source: "messages", replace: onMessages });
		dialogOpen = true;
	}

	const onMessages = $derived(dataStore.source === "messages");

	/** "Messenger · 4 363 — WhatsApp · 812", once more than one service is in. */
	const networksLabel = $derived(
		dataStore.messagesSummary
			.map(
				(s) =>
					`${NETWORK_LABELS[s.network]} · ${s.messages.toLocaleString()}`,
			)
			.join(" — "),
	);

	const tabs = [
		{ label: "Explore", href: resolve("/messages/explore") },
		{ label: "Other", href: resolve("/messages/guide") },
	];

	async function handleFileChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = target.files;
		if (files && files.length > 0) {
			await dataStore.handleMessagesFilesUpload(files, {
				replace: replaceNext,
			});
		}
		target.value = "";
		replaceNext = false;
	}
</script>

<div class="messages-shell">
	<header class="messages-header">
		<div class="header-left">
			<span class="source-title">Messages</span>
		</div>

		<div class="header-center">
			<SourceNav tabs={tabs} ariaLabel="Messages views" />
		</div>

		<div class="header-right">
			<input
				type="file"
				accept=".json,.txt,.zip"
				multiple
				class="hidden"
				bind:this={fileInput}
				onchange={handleFileChange}
			/>
			<!-- Folder picking needs its own input: `webkitdirectory` turns the
			     native dialog into a directory-only chooser, so it can't be the
			     same control as the file one. Non-JSON entries (the media/ folder)
			     are skipped while reading. -->
			<input
				type="file"
				webkitdirectory
				class="hidden"
				bind:this={folderInput}
				onchange={handleFileChange}
			/>
			<MessagesImportDialog
				bind:open={dialogOpen}
				onClose={() => (dialogOpen = false)}
				onPickFile={(replace) => {
					replaceNext = replace;
					fileInput?.click();
				}}
				onPickFolder={(replace) => {
					replaceNext = replace;
					folderInput?.click();
				}}
				onDropEntries={(read, replace) =>
					dataStore.handleMessagesImport(read, { replace })}
			/>
			<div class="upload-pill">
				{#if dataStore.loading}
					<span class="dot loading"></span>
					<span class="muted">Loading…</span>
				{:else if onMessages}
					<span class="dot ok"></span>
					<span class="ok-text" title={networksLabel}>
						{networksLabel || "Your data"}
					</span>
					<button
						class="upload-btn"
						type="button"
						onclick={openImportDialog}
						disabled={!!dataStore.loading}>Add / replace</button
					>
				{:else}
					<button
						class="upload-btn primary"
						type="button"
						onclick={openImportDialog}
						disabled={!!dataStore.loading}>Import my messages</button
					>
				{/if}
			</div>
		</div>
	</header>

	<ImportStatus />

	<div class="messages-content">
		{@render children()}
	</div>
</div>

<style>
	.messages-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.messages-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.messages-header {
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
		/* Messages keeps its own brand hue on the shared segmented toggle. */
		--source-accent: var(--accent-messages);
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
		.messages-header {
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
