<script lang="ts">
	import { onMount } from 'svelte';
	import { recentSessions, type RecentSession } from '$lib/client/api';
	import Logo from './Logo.svelte';

	let recent = $state<RecentSession[]>([]);
	onMount(() => (recent = recentSessions()));
</script>

<header class="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
	<a href="/" class="rounded-md" aria-label="PuzzleAR home"><Logo /></a>
	<nav class="ml-auto flex items-center gap-1 text-[0.9375rem]" aria-label="Main">
		{#if recent.length}
			<a href="/p/{recent[0].id}/review" class="btn btn-ghost btn-sm text-teal">Resume puzzle</a>
		{/if}
		<a href="/#how" class="btn btn-ghost btn-sm max-sm:hidden">How it works</a>
		<a href="/privacy" class="btn btn-ghost btn-sm">Privacy</a>
	</nav>
</header>
