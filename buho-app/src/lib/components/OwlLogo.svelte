<script lang="ts">
	// Cute, simple owl mark. Uses `currentColor` so it inherits the
	// surrounding text color; the eyes and beak are punched out via a mask so
	// the background shows through (the beak therefore reads darker than the
	// body, and it all works on any backdrop).
	let { size = 28, class: className = "" }: { size?: number; class?: string } =
		$props();

	// Unique mask id per instance to avoid collisions when several logos render.
	const maskId = `owl-cut-${Math.random().toString(36).slice(2, 9)}`;
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 64 64"
	fill="currentColor"
	class={className}
	role="img"
	aria-label="Buho owl"
	stroke-linejoin="round"
>
	<defs>
		<mask id={maskId}>
			<rect width="64" height="64" fill="#fff" />
			<!-- eyes -->
			<circle cx="24" cy="28" r="8" fill="#000" />
			<circle cx="40" cy="28" r="8" fill="#000" />
			<!-- beak -->
			<path
				d="M28.5 32.5 L35.5 32.5 Q34.8 35.8 32 38.5 Q29.2 35.8 28.5 32.5 Z"
				fill="#000"
			/>
		</mask>
	</defs>

	<g mask="url(#{maskId})">
		<!-- ear tufts -->
		<path d="M15 15 L21 3 L26 13 Z" />
		<path d="M49 15 L43 3 L38 13 Z" />
		<!-- body -->
		<path
			d="M32 8 C19 8 11 18 11 30 C11 46 20 58 32 58 C44 58 53 46 53 30 C53 18 45 8 32 8 Z"
		/>
	</g>

	<!-- pupils (slightly crossed, looking down) -->
	<circle cx="25.5" cy="31" r="3.2" />
	<circle cx="38.5" cy="31" r="3.2" />

	<!-- feet -->
	<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none">
		<path
			d="M27 56.5 L27 60.5 M27 60.5 L24.5 62.5 M27 60.5 L27 62.5 M27 60.5 L29.5 62.5"
		/>
		<path
			d="M37 56.5 L37 60.5 M37 60.5 L34.5 62.5 M37 60.5 L37 62.5 M37 60.5 L39.5 62.5"
		/>
	</g>
</svg>
