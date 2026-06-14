<script lang="ts">
	export let title: string;
	export let description: string;
	export let available: boolean = false;
	export let link: string = '#';
	export let image: string = '';
</script>

{#if available}
	<a
		href={link}
		class="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-lg cursor-pointer hover:-translate-y-1"
	>
		<div class="mb-4 flex items-center justify-between">
			<h3 class="text-xl font-semibold tracking-tight text-card-foreground">
				{title}
			</h3>
			<span
				class="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
			>
				Available
			</span>
		</div>

		{#if image}
			<div class="mb-4 aspect-video w-full overflow-hidden rounded-md bg-muted">
				<img src={image} alt="{title} preview" class="h-full w-full object-cover" />
			</div>
		{/if}

		<p class="text-sm text-muted-foreground">
			{description}
		</p>
	</a>
{:else}
	<div
		class="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-6 transition-all cursor-not-allowed opacity-60"
		role="article"
		aria-label="{title} - Coming Soon"
	>
		<div class="mb-4 flex items-center justify-between">
			<h3 class="text-xl font-semibold tracking-tight text-card-foreground">
				{title}
			</h3>
			<span
				class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
			>
				Coming Soon
			</span>
		</div>

		{#if image}
			<div class="mb-4 aspect-video w-full overflow-hidden rounded-md bg-muted">
				<img src={image} alt="{title} preview" class="h-full w-full object-cover" />
			</div>
		{/if}

		<p class="text-sm text-muted-foreground">
			{description}
		</p>
	</div>
{/if}
