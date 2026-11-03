<script lang="ts">
	import { onMount } from 'svelte';
	import { Trash2 } from '@lucide/svelte';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import { api, forgetSession, recentSessions, type RecentSession } from '$lib/client/api';
	import { toast } from '$lib/client/toasts.svelte';

	let sessions = $state<RecentSession[]>([]);
	let busy = $state<string | null>(null);
	onMount(() => (sessions = recentSessions()));

	async function remove(id: string) {
		busy = id;
		try {
			await api.deleteSession(id);
		} catch (err) {
			const code = (err as { code?: string }).code;
			if (code !== 'SESSION_EXPIRED' && code !== 'NOT_FOUND') {
				toast((err as Error).message, 'error');
				busy = null;
				return;
			}
		}
		forgetSession(id);
		sessions = recentSessions();
		busy = null;
		toast('Session deleted.', 'success');
	}

	const fmt = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<svelte:head><title>Privacy · PuzzleAR</title></svelte:head>

<SiteHeader />

<main id="main" class="mx-auto max-w-[720px] px-4 pt-6 pb-20 sm:px-6">
	<h1 class="text-title font-semibold tracking-[-0.03em]">Privacy and your photos</h1>
	<div class="mt-6 grid gap-6 text-[1rem] leading-7">
		<section>
			<h2 class="text-[1.125rem] font-semibold">What happens to a photo</h2>
			<p class="text-muted mt-1.5">
				When you scan, your photo is resized on your device (which also removes location and camera metadata), stored privately on Cloudflare, and sent to Meta's SAM 3.1 API, which returns the outline of each piece. Matching, solving and placement checks run in your browser.
			</p>
		</section>
		<section>
			<h2 class="text-[1.125rem] font-semibold">Check photos stay on your device</h2>
			<p class="text-muted mt-1.5">Photos taken to check a placement are compared in your browser and are never uploaded.</p>
		</section>
		<section>
			<h2 class="text-[1.125rem] font-semibold">No account, 24-hour sessions</h2>
			<p class="text-muted mt-1.5">
				Each puzzle is an anonymous session opened only by the browser that created it, using a private cookie. Sessions and their photos are deleted automatically 24 hours after they start. You can delete them sooner below or from the finish screen.
			</p>
		</section>
		<section>
			<h2 class="text-[1.125rem] font-semibold">Camera</h2>
			<p class="text-muted mt-1.5">The camera is only requested when you choose “Use Camera”. You can always upload a photo instead.</p>
		</section>
	</div>

	<section class="card mt-10 p-5">
		<h2 class="font-semibold">Sessions in this browser</h2>
		{#if sessions.length}
			<ul class="divide-line mt-3 divide-y">
				{#each sessions as s (s.id)}
					<li class="flex items-center gap-3 py-3">
						<div class="min-w-0 flex-1">
							<a class="font-medium hover:underline" href="/p/{s.id}/review">{s.label ?? 'Puzzle'}</a>
							<p class="text-muted text-[0.8125rem]">Started {fmt(s.createdAt)}</p>
						</div>
						<button class="btn btn-danger btn-sm" onclick={() => remove(s.id)} disabled={busy === s.id}>
							<Trash2 class="size-4" /> {busy === s.id ? 'Deleting…' : 'Delete Session'}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted mt-2 text-[0.9375rem]">No active sessions from this browser.</p>
		{/if}
	</section>
</main>
