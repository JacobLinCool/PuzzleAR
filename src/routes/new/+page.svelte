<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Camera, FlashlightOff, Flashlight, ImageUp, RefreshCcw, SwitchCamera, TriangleAlert, X } from '@lucide/svelte';
	import AppBar from '$lib/components/AppBar.svelte';
	import CameraView from '$lib/components/CameraView.svelte';
	import { ApiError, api, rememberSession } from '$lib/client/api';
	import { checkQuality, normalizePhoto, type QualityReport } from '$lib/client/image';
	import { startSample } from '$lib/client/sample';
	import { toast } from '$lib/client/toasts.svelte';
	import type { WorkspaceDoc } from '$lib/shared/doc';

	type Phase = 'choose' | 'camera' | 'preview' | 'sending';
	let phase = $state<Phase>('choose');
	let source = $state<'camera' | 'upload'>('upload');
	let cam = $state<CameraView>();
	let camReady = $state(false);
	let torchSupported = $state(false);
	let torchOn = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let photo = $state<{ blob: Blob; url: string; width: number; height: number } | null>(null);
	let quality = $state<QualityReport | null>(null);
	let dismissed = $state(new Set<string>());
	let sendStage = $state('');
	let cameraError = $state<string | null>(null);
	let scannerAvailable = $state(true);

	onMount(() => {
		api.status().then((s) => (scannerAvailable = s.scannerAvailable)).catch(() => {});
		return () => photo && URL.revokeObjectURL(photo.url);
	});

	async function accept(input: Blob | ImageBitmap) {
		try {
			const n = await normalizePhoto(input);
			if (photo) URL.revokeObjectURL(photo.url);
			photo = { blob: n.blob, url: URL.createObjectURL(n.blob), width: n.bitmap.width, height: n.bitmap.height };
			quality = await checkQuality(n.bitmap);
			dismissed = new Set();
			phase = 'preview';
		} catch {
			toast('We could not open that image. Please try a JPEG, PNG or WebP photo.', 'error');
		}
	}

	function onFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		(e.currentTarget as HTMLInputElement).value = '';
		if (!f) return;
		if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) {
			toast('Please choose a JPEG, PNG or WebP photo.', 'error');
			return;
		}
		if (f.size > 40 * 1024 * 1024) {
			toast('That file is very large. Please use a photo under 40 MB.', 'error');
			return;
		}
		source = 'upload';
		void accept(f);
	}

	async function capture() {
		if (!cam) return;
		const frame = await cam.grab();
		source = 'camera';
		cam.stop();
		await accept(frame);
	}

	function retake() {
		phase = source === 'camera' ? 'camera' : 'choose';
		if (source === 'upload') fileInput?.click();
	}

	async function usePhoto() {
		if (!photo) return;
		phase = 'sending';
		try {
			sendStage = 'Creating your puzzle…';
			const s = await api.createSession(source);
			sendStage = 'Uploading photo…';
			const media = await api.uploadMedia(s.id, photo.blob);
			const warnings = [...(quality?.warnings.filter((w) => !dismissed.has(w.id)).map((w) => w.message) ?? []), ...media.warnings];
			const doc: WorkspaceDoc = {
				...s.doc,
				state: 'PHOTO_READY',
				startedAt: Date.now(),
				photo: { mediaId: media.mediaId, url: media.url, width: media.width, height: media.height, source, warnings }
			};
			await api.saveDoc(s.id, s.revision, doc);
			rememberSession({ id: s.id, createdAt: Date.now(), mode: source, label: 'Your puzzle' });
			await goto(`/p/${s.id}/review`);
		} catch (err) {
			phase = 'preview';
			toast(err instanceof ApiError ? err.message : 'Upload failed. Please try again.', 'error', { label: 'Retry', run: usePhoto });
		}
	}

	const activeWarnings = $derived(quality?.warnings.filter((w) => !dismissed.has(w.id)) ?? []);
</script>

<svelte:head><title>Scan your puzzle · PuzzleAR</title></svelte:head>

<AppBar step={1} />

<input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" class="hidden" onchange={onFile} />

<main id="main" class="mx-auto max-w-[1440px] px-4 pt-5 pb-28 lg:px-6 lg:pb-10">
	{#if phase === 'choose'}
		<div class="mx-auto max-w-[1040px]" style="animation: rise 320ms var(--ease-out-expo) both">
			<h1 class="text-title font-semibold tracking-[-0.03em]">Set up your workspace</h1>
			<p class="text-muted mt-2 max-w-[40rem]">Spread the pieces apart so each edge is visible. One photo from above is all it takes.</p>

			<ol class="mt-8 grid gap-6 sm:grid-cols-3">
				<li>
					<svg viewBox="0 0 200 120" class="bg-surface border-line w-full rounded-[14px] border" aria-hidden="true">
						<rect x="40" y="58" width="120" height="50" rx="4" fill="#2f4a3e" />
						<path d="M100 14v30" stroke="#24312d" stroke-width="2" />
						<rect x="82" y="8" width="36" height="16" rx="4" fill="#24312d" />
						<circle cx="100" cy="24" r="4" fill="#7fe0d0" />
						<path d="M100 28 60 58M100 28l40 30" stroke="#167A6B" stroke-dasharray="3 4" stroke-width="1.5" />
					</svg>
					<h2 class="mt-3 font-semibold">Camera straight above</h2>
					<p class="text-muted text-[0.875rem] leading-5">Hold the phone level or prop it on a stand. Avoid glare from lamps and glossy pieces.</p>
				</li>
				<li>
					<svg viewBox="0 0 200 120" class="bg-surface border-line w-full rounded-[14px] border" aria-hidden="true">
						<rect x="16" y="14" width="168" height="92" rx="6" fill="#2f4a3e" />
						{#each [[40, 34], [92, 30], [146, 40], [56, 74], [112, 76]] as [x, y], i (i)}
							<rect x={x} y={y} width="22" height="22" rx="3" fill="#f2cc8f" transform="rotate({i * 23 - 30} {x + 11} {y + 11})" />
						{/each}
						<path d="M70 45h16M120 50h18" stroke="#bff3ea" stroke-width="1.5" stroke-dasharray="2 3" />
					</svg>
					<h2 class="mt-3 font-semibold">Pieces apart, face up</h2>
					<p class="text-muted text-[0.875rem] leading-5">Leave a finger's width between pieces. Up to 16 pieces per photo.</p>
				</li>
				<li>
					<svg viewBox="0 0 200 120" class="bg-surface border-line w-full rounded-[14px] border" aria-hidden="true">
						<rect x="16" y="14" width="168" height="92" rx="6" fill="#2f4a3e" />
						<rect x="24" y="30" width="18" height="18" rx="3" fill="#f2cc8f" />
						<rect x="52" y="64" width="18" height="18" rx="3" fill="#e07a5f" />
						<rect x="96" y="24" width="78" height="72" rx="3" fill="#d8c39b" />
						<rect x="106" y="34" width="58" height="52" fill="none" stroke="#5a4a32" stroke-dasharray="4 3" stroke-width="1.5" />
					</svg>
					<h2 class="mt-3 font-semibold">Leave room to build</h2>
					<p class="text-muted text-[0.875rem] leading-5">Keep an empty area in view. You can mark it later so we can show where each piece goes.</p>
				</li>
			</ol>

			{#if !scannerAvailable}
				<div class="bg-amber-soft text-amber-ink mt-8 flex items-start gap-3 rounded-[12px] px-4 py-3" role="status">
					<TriangleAlert class="mt-0.5 size-[18px] shrink-0" />
					<p>The scanner is unavailable on this server right now. You can still explore the full flow with the sample puzzle.</p>
				</div>
			{/if}

			<div class="mt-8 flex flex-wrap items-center gap-3">
				<button class="btn btn-primary h-12 px-5 text-base" onclick={() => ((cameraError = null), (phase = 'camera'))}>
					<Camera class="size-[18px]" /> Use Camera
				</button>
				<button class="btn btn-secondary h-12 px-5 text-base" onclick={() => fileInput?.click()}>
					<ImageUp class="size-[18px]" /> Upload Photo
				</button>
				<button class="btn btn-quiet h-12" onclick={startSample}>No puzzle handy? Try the sample</button>
			</div>
			<p class="text-muted mt-5 max-w-[44rem] text-[0.8125rem] leading-5">
				Your photo is sent to Meta's SAM 3.1 API to find the pieces. It is stored privately for 24 hours, then deleted; you can delete it at any time. <a href="/privacy" class="text-ink underline">Privacy details</a>
			</p>
		</div>
	{:else if phase === 'camera'}
		<div class="grid gap-5 lg:grid-cols-[68fr_32fr]">
			{#if cameraError}
				<div class="card grid min-h-[50vh] place-items-center p-8 text-center">
					<div class="max-w-sm">
						<TriangleAlert class="text-amber mx-auto size-8" />
						<p class="mt-3 font-semibold">{cameraError}</p>
						<div class="mt-5 flex justify-center gap-3">
							<button class="btn btn-primary" onclick={() => fileInput?.click()}><ImageUp class="size-4" /> Upload Photo</button>
							<button class="btn btn-secondary" onclick={() => (phase = 'choose')}>Back</button>
						</div>
					</div>
				</div>
			{:else}
				<CameraView
					bind:this={cam}
					bind:ready={camReady}
					bind:torchSupported
					class="aspect-[4/3] w-full max-lg:max-h-[62vh]"
					onerror={(_, m) => (cameraError = m)}
				>
					{#snippet overlay({ width, height })}
						<rect
							x={width * 0.04}
							y={height * 0.05}
							width={width * 0.92}
							height={height * 0.9}
							rx={Math.min(width, height) * 0.03}
							fill="none"
							stroke="white"
							stroke-opacity="0.75"
							stroke-width={Math.max(2, width / 500)}
							stroke-dasharray="{width / 60} {width / 90}"
						/>
						<text x={width / 2} y={height * 0.05 + width / 28} text-anchor="middle" fill="white" font-size={width / 42} font-weight="600" style="paint-order: stroke" stroke="rgba(0,0,0,0.35)" stroke-width={width / 400}>Keep all pieces apart</text>
					{/snippet}
				</CameraView>
			{/if}
			<aside class="flex flex-col gap-5">
				<div class="card p-5">
					<h1 class="text-h2 font-semibold tracking-[-0.02em]">Frame the table</h1>
					<ul class="text-muted mt-3 grid gap-2.5 text-[0.9375rem]">
						<li class="flex gap-2.5"><span class="bg-teal mt-2 size-1.5 shrink-0 rounded-full"></span>Every piece fully inside the dashed frame</li>
						<li class="flex gap-2.5"><span class="bg-teal mt-2 size-1.5 shrink-0 rounded-full"></span>Camera straight above, not at an angle</li>
						<li class="flex gap-2.5"><span class="bg-teal mt-2 size-1.5 shrink-0 rounded-full"></span>Soft, even light without reflections</li>
						<li class="flex gap-2.5"><span class="bg-teal mt-2 size-1.5 shrink-0 rounded-full"></span>An empty area left for assembling</li>
					</ul>
				</div>
				<div class="max-lg:bg-ground/95 max-lg:border-line flex items-center gap-2 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:px-4 max-lg:pt-3 max-lg:pb-[calc(env(safe-area-inset-bottom)+12px)] max-lg:backdrop-blur-md">
					<button class="btn btn-secondary size-12 !px-0" aria-label="Cancel" onclick={() => (cam?.stop(), (phase = 'choose'))}><X class="size-5" /></button>
					<button class="btn btn-primary h-12 flex-1 text-base" disabled={!camReady} onclick={capture}><Camera class="size-5" /> Capture</button>
					<button class="btn btn-secondary size-12 !px-0" aria-label="Switch camera" disabled={!camReady} onclick={() => cam?.flip()}><SwitchCamera class="size-5" /></button>
					{#if torchSupported}
						<button class="btn btn-secondary size-12 !px-0" aria-label={torchOn ? 'Turn flash off' : 'Turn flash on'} aria-pressed={torchOn} onclick={async () => { await cam?.setTorch(!torchOn); torchOn = !torchOn; }}>
							{#if torchOn}<FlashlightOff class="size-5" />{:else}<Flashlight class="size-5" />{/if}
						</button>
					{/if}
				</div>
			</aside>
		</div>
	{:else if photo}
		<div class="grid gap-5 lg:grid-cols-[68fr_32fr]">
			<div class="relative overflow-hidden rounded-[16px] bg-[#1d2622]">
				<img src={photo.url} alt="The pieces you photographed" class="mx-auto block max-h-[70vh] w-auto max-w-full object-contain {phase === 'sending' ? 'opacity-70' : ''}" />
				{#if phase === 'sending'}
					<div class="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/45 px-4 py-3 text-white backdrop-blur-sm" role="status">
						<span class="size-2 rounded-full bg-white" style="animation: breathe 1s ease-in-out infinite"></span>
						{sendStage}
					</div>
				{/if}
			</div>
			<aside class="flex flex-col gap-5">
				<div class="card p-5">
					<h1 class="text-h2 font-semibold tracking-[-0.02em]">Use this photo?</h1>
					<p class="text-muted tabular mt-1 text-[0.8125rem]">{photo.width} × {photo.height} px</p>
					{#if activeWarnings.length}
						<ul class="mt-4 grid gap-2.5">
							{#each activeWarnings as w (w.id)}
								<li class="bg-amber-soft text-amber-ink flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[0.875rem] leading-5">
									<TriangleAlert class="mt-0.5 size-4 shrink-0" />
									<span class="flex-1">{w.message}</span>
									<button class="hover:text-ink -mr-1 shrink-0 rounded p-0.5" aria-label="Ignore this warning" onclick={() => (dismissed = new Set([...dismissed, w.id]))}><X class="size-4" /></button>
								</li>
							{/each}
						</ul>
						<p class="text-muted mt-3 text-[0.8125rem]">These are suggestions. You can continue anyway.</p>
					{:else}
						<p class="text-verified mt-4 text-[0.9375rem] font-medium">Sharp, well lit and large enough.</p>
					{/if}
				</div>
				<div class="max-lg:bg-ground/95 max-lg:border-line flex gap-2 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:px-4 max-lg:pt-3 max-lg:pb-[calc(env(safe-area-inset-bottom)+12px)] max-lg:backdrop-blur-md">
					<button class="btn btn-secondary h-12 flex-1" onclick={retake} disabled={phase === 'sending'}><RefreshCcw class="size-4" /> Retake</button>
					<button class="btn btn-primary h-12 flex-[1.4] text-base" onclick={usePhoto} disabled={phase === 'sending' || !scannerAvailable} title={scannerAvailable ? '' : 'Scanner unavailable'}>
						{phase === 'sending' ? 'Uploading…' : 'Use This Photo'}
					</button>
				</div>
			</aside>
		</div>
	{/if}
</main>
