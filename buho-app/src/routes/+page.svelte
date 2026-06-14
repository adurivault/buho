<script lang="ts">
	import DataSourceCard from "$lib/components/DataSourceCard.svelte";
	import OwlLogo from "$lib/components/OwlLogo.svelte";
	import Github from "lucide-svelte/icons/github";
	import { resolve } from "$app/paths";

	const dataSources = [
		{
			title: "Spotify",
			description:
				"Analyze your listening history, top artists, and streaming patterns.",
			available: true,
			link: resolve("/spotify/explore"),
			image: "", // Removed per user request
		},
		{
			title: "Google Maps",
			description: "Visualize your location history and travel patterns.",
			available: false,
			link: "#",
			image: "",
		},
		{
			title: "WhatsApp",
			description: "Explore chat statistics and communication trends.",
			available: false,
			link: "#",
			image: "",
		},
	];
</script>

<div class="flex min-h-screen flex-col bg-background text-foreground">
	<!-- Mobile Warning Overlay -->
	<div
		class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background p-6 text-center md:hidden"
	>
		<div class="mb-6 rounded-full bg-primary/10 p-4 text-primary">
			<OwlLogo size={40} />
		</div>
		<h2 class="mb-2 text-2xl font-bold">Desktop Experience</h2>
		<p class="text-muted-foreground">
			Buho is designed for detailed data exploration on larger screens.
			Please visit us on a desktop computer for the best experience.
		</p>
	</div>

	<!-- Main Content -->
	<main class="hidden flex-1 md:flex md:flex-col">
		<div
			class="container mx-auto flex max-w-5xl flex-1 flex-col px-4 py-16"
		>
			<!-- Hero Section -->
			<div class="mb-16 flex flex-col items-center text-center">
				<div class="mb-6">
					<span
						class="text-6xl font-bold tracking-tighter text-primary"
						>Buho</span
					>
				</div>
				<h1
					class="mb-6 text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl"
				>
					Your Data, <span class="text-primary"
						>Beautifully Visualized</span
					>
				</h1>
				<p class="mb-8 max-w-2xl text-lg text-muted-foreground">
					Explore your personal data from Spotify, Google Maps, and
					more through interactive visualizations.
				</p>
				<p class="mb-8 max-w-2xl text-lg text-muted-foreground">
					Your data never leaves your computer.
				</p>
			</div>

			<!-- Data Sources Grid -->
			<div class="mb-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{#each dataSources as source}
					<DataSourceCard
						title={source.title}
						description={source.description}
						available={source.available}
						link={source.link}
						image={source.image}
					/>
				{/each}
			</div>

			<!-- Footer / Links -->
			<div class="mt-auto flex justify-center py-8">
				<a
					href="https://github.com/adurivault/buho"
					target="_blank"
					rel="noreferrer"
					class="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
				>
					<Github class="h-4 w-4" />
					<span>View source on GitHub</span>
				</a>
			</div>
		</div>
	</main>
</div>
