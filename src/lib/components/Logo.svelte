<script lang="ts">
	let { size = 28, withWord = true }: { size?: number; withWord?: boolean } = $props();
</script>

<span class="inline-flex items-center gap-2.5">
	<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
		<rect width="32" height="32" rx="8" fill="var(--color-teal)" />
		<path
			d="M8 9h5.2a3 3 0 1 1 5.6 0H24v5.2a3 3 0 1 0 0 5.6V25h-5.2a3 3 0 1 1-5.6 0H8v-5.2a3 3 0 1 1 0-5.6z"
			fill="none"
			stroke="var(--color-ground)"
			stroke-width="2"
			stroke-linejoin="round"
		/>
	</svg>
	{#if withWord}<span class="text-[1.0625rem] font-semibold tracking-[-0.02em]">PuzzleAR</span>{/if}
</span>
