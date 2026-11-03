<script lang="ts">
	import { page } from '$app/state';
	import { TriangleAlert } from '@lucide/svelte';
	import { Workspace } from '$lib/client/workspace.svelte';
	import { forgetSession } from '$lib/client/api';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	const ws = $derived(Workspace.get(data.id));

	$effect(() => {
		void ws.load();
	});

	$effect(() => {
		if (ws.loadError && ['SESSION_EXPIRED', 'FORBIDDEN', 'NOT_FOUND'].includes(ws.loadError.code)) forgetSession(ws.id);
	});

	function onKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select, [contenteditable]')) return;
		if (e.metaKey || e.ctrlKey || e.altKey) {
			if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				if (e.shiftKey) ws.redo();
				else ws.undo();
			}
			return;
		}
		if (e.key === 'z') ws.undo();
		else if (e.key === 'Z') ws.redo();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if ws.loadError}
	<main id="main" class="grid min-h-[80vh] place-items-center px-4">
		<div class="max-w-md text-center">
			<TriangleAlert class="text-amber mx-auto size-9" />
			<h1 class="text-h2 mt-4 font-semibold">
				{ws.loadError.code === 'SESSION_EXPIRED' ? 'This puzzle session has ended' : ws.loadError.code === 'FORBIDDEN' ? 'This puzzle is private' : 'We could not open this puzzle'}
			</h1>
			<p class="text-muted mt-2">{ws.loadError.message}</p>
			<div class="mt-6 flex justify-center gap-3">
				{#if ws.loadError.retryable}<button class="btn btn-secondary" onclick={() => ws.load(true)}>Try again</button>{/if}
				<a class="btn btn-primary" href="/new">Start a new puzzle</a>
			</div>
			<p class="text-muted mt-6 text-[0.8125rem]">Sessions and photos are deleted after 24 hours. Links only open in the browser that created them.</p>
		</div>
	</main>
{:else}
	{#key page.url.pathname}
		{@render children()}
	{/key}
{/if}
