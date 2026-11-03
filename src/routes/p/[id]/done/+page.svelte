<script lang="ts">
	import { goto } from '$app/navigation';
	import { Download, FileJson, Plus, Trash2, Undo2 } from '@lucide/svelte';
	import AppBar from '$lib/components/AppBar.svelte';
	import BoardView from '$lib/components/BoardView.svelte';
	import { api, forgetSession } from '$lib/client/api';
	import { downloadBlob } from '$lib/client/image';
	import { formatDuration } from '$lib/client/puzzle';
	import { renderBoardPNG, type BoardItem } from '$lib/client/render';
	import { toast } from '$lib/client/toasts.svelte';
	import { Workspace } from '$lib/client/workspace.svelte';
	import { activeCandidate } from '$lib/shared/doc';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ws = $derived(Workspace.get(data.id));
	const doc = $derived(ws.doc);
	const act = $derived(doc ? activeCandidate(doc) : undefined);
	let deleting = $state(false);
	let confirmDelete = $state(false);

	$effect(() => {
		if (doc && doc.state !== 'COMPLETED') void goto(`/p/${ws.id}/guide`, { replaceState: true });
	});

	const items = $derived.by((): BoardItem[] => {
		if (!act || !doc || !ws.photo) return [];
		const out: BoardItem[] = [];
		for (const p of act.candidate.placements) {
			const pc = ws.pieceById(p.pieceId);
			const g = pc && ws.geom(pc);
			const c = pc && ws.cutout(pc);
			if (pc && g && c) out.push({ placement: p, geom: g, mask: doc.masks[pc.maskKey], cutout: c });
		}
		return out;
	});

	const stats = $derived.by(() => {
		if (!doc) return null;
		const manualPlacements = doc.placements.filter((p) => p.source === 'manual').length;
		const verified = doc.placements.filter((p) => p.source === 'vision').length;
		const fits = doc.constraints.filter((c) => c.type === 'fits').length;
		const corrected = doc.pieces.filter((p) => p.status !== 'removed' && (p.corners || p.sideTypes || p.origin === 'refine' || p.version > 1)).length;
		const start = doc.startedAt ?? doc.guideStartedAt;
		return {
			pieces: ws.pieces.length,
			verified,
			manualPlacements,
			fits,
			corrected,
			time: start && doc.completedAt ? formatDuration(doc.completedAt - start) : '—'
		};
	});

	async function downloadPng() {
		if (!act) return;
		downloadBlob(await renderBoardPNG(items, act.solution.rows, act.solution.cols), `puzzlear-${ws.id}-assembled.png`);
	}

	async function del() {
		deleting = true;
		try {
			await ws.flush();
			await api.deleteSession(ws.id);
			forgetSession(ws.id);
			Workspace.forget(ws.id);
			toast('Deleted. Your photo and puzzle data are gone from our servers.', 'success');
			await goto('/');
		} catch (err) {
			toast((err as Error).message, 'error');
			deleting = false;
		}
	}
</script>

<svelte:head><title>Finished · PuzzleAR</title></svelte:head>

<AppBar {ws} step={4} />

{#if doc && act && stats}
	<main id="main" class="mx-auto max-w-[1200px] px-4 pt-8 pb-16 lg:px-6">
		<div style="animation: rise 360ms var(--ease-out-expo) both">
			<h1 class="text-title font-semibold tracking-[-0.03em]">The final piece fits. Nice work together.</h1>
			<p class="text-muted mt-2">From a scattered table to a finished {act.solution.rows} × {act.solution.cols} board.</p>
		</div>

		<div class="mt-8 grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
			<figure class="min-w-0">
				<img src={doc.photo?.url} alt="The pieces as you first photographed them" class="w-full rounded-[16px] object-cover shadow-[var(--shadow-lift)]" />
				<figcaption class="text-muted mt-2 text-[0.8125rem]">Where you started</figcaption>
			</figure>
			<span class="text-muted hidden text-2xl lg:block" aria-hidden="true">→</span>
			<figure class="min-w-0">
				<div class="card p-4" style="animation: settle 420ms var(--ease-out-expo) both">
					<BoardView rows={act.solution.rows} cols={act.solution.cols} {items} kraft />
				</div>
				<figcaption class="text-muted mt-2 text-[0.8125rem]">Your board, rebuilt from the real piece textures</figcaption>
			</figure>
		</div>

		<dl class="border-line mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] border bg-[var(--color-line)] sm:grid-cols-5">
			{#each [
				['Pieces', stats.pieces],
				['Checked by photo', stats.verified],
				['Confirmed by hand', stats.manualPlacements],
				['Fits you confirmed', stats.fits],
				['Time', stats.time]
			] as [k, v] (k)}
				<div class="bg-surface px-4 py-4">
					<dt class="text-muted text-[0.8125rem]">{k}</dt>
					<dd class="tabular mt-1 text-[1.375rem] font-semibold tracking-[-0.02em]">{v}</dd>
				</div>
			{/each}
		</dl>
		{#if stats.corrected}
			<p class="text-muted mt-3 text-[0.8125rem]">{stats.corrected} {stats.corrected === 1 ? 'piece needed' : 'pieces needed'} a manual correction during review.</p>
		{/if}

		<div class="mt-8 flex flex-wrap gap-3">
			<button class="btn btn-primary h-12 px-5" onclick={downloadPng}><Download class="size-[18px]" /> Download assembled.png</button>
			<a class="btn btn-secondary h-12 px-5" href="/api/sessions/{ws.id}/export?format=json" download><FileJson class="size-[18px]" /> solution.json</a>
			<a class="btn btn-secondary h-12 px-5" href="/new"><Plus class="size-[18px]" /> New puzzle</a>
			<button class="btn btn-quiet h-12" onclick={() => ws.undo()} disabled={!ws.canUndo}><Undo2 class="size-4" /> Undo last step</button>
		</div>

		<div class="border-line mt-12 border-t pt-6">
			{#if confirmDelete}
				<div class="flex flex-wrap items-center gap-3">
					<p class="text-[0.9375rem]">Delete the photo, outlines and solution now? This cannot be undone.</p>
					<button class="btn btn-danger" onclick={del} disabled={deleting}><Trash2 class="size-4" /> {deleting ? 'Deleting…' : 'Delete everything'}</button>
					<button class="btn btn-quiet" onclick={() => (confirmDelete = false)}>Keep it</button>
				</div>
			{:else}
				<button class="btn btn-quiet text-error" onclick={() => (confirmDelete = true)}><Trash2 class="size-4" /> Delete this session</button>
				<p class="text-muted mt-1 text-[0.8125rem]">Otherwise it is deleted automatically 24 hours after you started.</p>
			{/if}
		</div>
	</main>
{/if}
