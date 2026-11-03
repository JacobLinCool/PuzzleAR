<!--
	Live camera preview. Requests permission only when mounted (after the user
	chose "Use camera"). Never fakes segmentation on the live feed.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onDestroy, onMount } from 'svelte';
	import { CLIENT_ERRORS } from '$lib/client/api';

	let {
		video = $bindable(),
		facing = $bindable<'environment' | 'user'>('environment'),
		ready = $bindable(false),
		torchSupported = $bindable(false),
		onerror,
		overlay,
		class: klass = ''
	}: {
		video?: HTMLVideoElement;
		facing?: 'environment' | 'user';
		ready?: boolean;
		torchSupported?: boolean;
		onerror?: (code: 'CAMERA_DENIED' | 'CAMERA_UNAVAILABLE', message: string) => void;
		overlay?: Snippet<[{ width: number; height: number }]>;
		class?: string;
	} = $props();

	let stream: MediaStream | null = null;
	let vw = $state(0);
	let vh = $state(0);
	let torch = $state(false);

	export async function start() {
		stop();
		ready = false;
		if (!navigator.mediaDevices?.getUserMedia) {
			onerror?.('CAMERA_UNAVAILABLE', CLIENT_ERRORS.CAMERA_UNAVAILABLE);
			return;
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } }
			});
			video!.srcObject = stream;
			await video!.play();
			vw = video!.videoWidth;
			vh = video!.videoHeight;
			const track = stream.getVideoTracks()[0];
			const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
			torchSupported = Boolean(caps.torch);
			ready = true;
		} catch (err) {
			const name = (err as DOMException).name;
			if (name === 'NotAllowedError' || name === 'SecurityError') onerror?.('CAMERA_DENIED', CLIENT_ERRORS.CAMERA_DENIED);
			else onerror?.('CAMERA_UNAVAILABLE', CLIENT_ERRORS.CAMERA_UNAVAILABLE);
		}
	}

	export function stop() {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	export async function setTorch(on: boolean) {
		const track = stream?.getVideoTracks()[0];
		if (!track) return;
		try {
			await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
			torch = on;
		} catch {
			torchSupported = false;
		}
	}

	export function torchOn() {
		return torch;
	}

	/** Grabs the current frame at full sensor resolution. */
	export async function grab(): Promise<ImageBitmap> {
		return createImageBitmap(video!);
	}

	export async function flip() {
		facing = facing === 'environment' ? 'user' : 'environment';
		await start();
	}

	onMount(() => void start());
	onDestroy(stop);
</script>

<div class="relative overflow-hidden rounded-[16px] bg-[#1d2622] {klass}">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} playsinline muted class="block size-full object-contain {facing === 'user' ? '-scale-x-100' : ''}"></video>
	{#if ready && vw && overlay}
		<svg viewBox="0 0 {vw} {vh}" preserveAspectRatio="xMidYMid meet" class="pointer-events-none absolute inset-0 size-full">
			{@render overlay({ width: vw, height: vh })}
		</svg>
	{/if}
	{#if !ready}
		<div class="absolute inset-0 grid place-items-center text-[0.875rem] text-white/70">
			<span style="animation: breathe 1.4s ease-in-out infinite">Starting camera…</span>
		</div>
	{/if}
</div>
