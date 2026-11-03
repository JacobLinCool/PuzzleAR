<script lang="ts">
	import { BadgeCheck, CircleDot, ScanSearch } from '@lucide/svelte';

	let { value, compact = false }: { value: 'strong' | 'check' | 'confirmed'; compact?: boolean } = $props();
	const meta = {
		strong: { label: 'Strong candidate', cls: 'bg-teal-soft text-teal', icon: CircleDot },
		check: { label: 'Needs a check', cls: 'bg-amber-soft text-amber-ink', icon: ScanSearch },
		confirmed: { label: 'Human-confirmed', cls: 'bg-verified-soft text-verified', icon: BadgeCheck }
	};
	const m = $derived(meta[value]);
</script>

<span class="chip {m.cls}" title={m.label}>
	<m.icon class="size-3.5" aria-hidden="true" />
	{#if compact}<span class="sr-only">{m.label}</span>{:else}{m.label}{/if}
</span>
