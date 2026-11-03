<!-- Top bar for the puzzle flow: where you are, undo/redo, session actions. -->
<script lang="ts">
	import { Check, Redo2, Undo2 } from '@lucide/svelte';
	import Logo from './Logo.svelte';
	import type { Workspace } from '$lib/client/workspace.svelte';

	let {
		ws,
		step,
		title
	}: {
		ws?: Workspace;
		step: 1 | 2 | 3 | 4;
		title?: string;
	} = $props();

	const steps = ['Scan', 'Review', 'Match', 'Assemble'];
	const links = $derived(
		ws ? ['/new', `/p/${ws.id}/review`, `/p/${ws.id}/solve`, `/p/${ws.id}/guide`] : ['/new', '#', '#', '#']
	);
	const sample = $derived(ws?.doc?.mode === 'demo');
	const preprocessed = $derived(ws?.doc?.segment?.preprocessed);

	function reachable(i: number) {
		const st = ws?.doc?.state;
		if (!st) return i === 0;
		if (i === 0) return true;
		if (i === 1) return st !== 'NEW' && st !== 'PHOTO_READY';
		if (i === 2) return ['SOLUTION_READY', 'GUIDING', 'COMPLETED', 'SOLVING'].includes(st);
		return ['GUIDING', 'COMPLETED', 'SOLUTION_READY'].includes(st);
	}
</script>

<header class="border-line/80 sticky top-0 z-30 border-b bg-[#F7F5F0]/92 backdrop-blur-md">
	<div class="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 lg:px-6">
		<a href="/" class="shrink-0 rounded-md" aria-label="PuzzleAR home"><Logo withWord={false} size={30} /></a>
		<nav aria-label="Progress" class="min-w-0 flex-1">
			<ol class="flex items-center gap-1 text-[0.8125rem] sm:gap-2">
				{#each steps as s, i (s)}
					{@const n = i + 1}
					{@const state = n < step ? 'done' : n === step ? 'current' : 'todo'}
					<li class="flex items-center gap-1 sm:gap-2 {state === 'current' ? '' : 'max-sm:hidden'}">
						{#if i > 0}<span class="bg-line-strong hidden h-px w-5 sm:block" aria-hidden="true"></span>{/if}
						{#if reachable(i) && state !== 'current'}
							<a href={links[i]} class="hover:bg-ground-deep flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 font-medium">
								<span class="bg-teal-soft text-teal grid size-5 place-items-center rounded-full"><Check class="size-3" strokeWidth={3} /></span>
								<span class="text-muted">{s}</span>
							</a>
						{:else}
							<span class="flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 font-medium {state === 'current' ? 'bg-surface border-line border' : ''}" aria-current={state === 'current' ? 'step' : undefined}>
								<span class="tabular grid size-5 place-items-center rounded-full text-[11px] badge-num font-semibold {state === 'current' ? 'bg-ink text-white' : 'border-line-strong text-muted border'}">{n}</span>
								<span class={state === 'current' ? 'text-ink' : 'text-muted'}>{s}</span>
								{#if state === 'current'}<span class="text-muted sm:hidden">· {n} of 4</span>{/if}
							</span>
						{/if}
					</li>
				{/each}
			</ol>
		</nav>
		{#if sample}
			<span class="chip bg-amber-soft text-amber-ink shrink-0" title="This session uses a sample photo{preprocessed ? ' and a stored real SAM 3.1 response' : ''}">
				<span class="md:hidden">Sample</span><span class="max-md:hidden">Sample session{preprocessed ? ' · Preprocessed example' : ''}</span>
			</span>
		{/if}
		{#if title}<span class="text-muted hidden truncate text-[0.8125rem] xl:block">{title}</span>{/if}
		{#if ws}
			<div class="flex items-center">
				<button class="btn btn-quiet size-10 !px-0" onclick={() => ws.undo()} disabled={!ws.canUndo} aria-label="Undo" title="Undo (Z)">
					<Undo2 class="size-[18px]" />
				</button>
				<button class="btn btn-quiet size-10 !px-0" onclick={() => ws.redo()} disabled={!ws.canRedo} aria-label="Redo" title="Redo (Shift+Z)">
					<Redo2 class="size-[18px]" />
				</button>
			</div>
		{/if}
	</div>
</header>
