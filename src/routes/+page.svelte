<script lang="ts">
	import { ArrowRight, BadgeCheck, Camera, CircleDot, ScanSearch } from '@lucide/svelte';
	import SamplePreview from '$lib/components/SamplePreview.svelte';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import { startSample } from '$lib/client/sample';

	let starting = $state(false);
	async function trySample() {
		starting = true;
		await startSample();
		starting = false;
	}
</script>

<svelte:head>
	<title>PuzzleAR · Find your next piece</title>
	<meta
		name="description"
		content="Find your next piece. Keep the joy of puzzling. PuzzleAR turns a photo of your scattered pieces into step-by-step help, without the box image."
	/>
</svelte:head>

<SiteHeader />

<main id="main">
	<section class="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pt-6 pb-20 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-16 lg:pt-10 lg:pb-28">
		<div class="max-w-[34rem]" style="animation: rise 420ms var(--ease-out-expo) both">
			<h1 class="text-[2.5rem] leading-[1.06] font-semibold tracking-[-0.035em] sm:text-[3.25rem]">
				Find your next piece. Keep the joy of puzzling.
			</h1>
			<p class="text-muted mt-5 max-w-[30rem] text-[1.0625rem] leading-7">
				PuzzleAR turns a photo of your scattered pieces into step-by-step help, without the box image.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<a href="/new" class="btn btn-primary h-12 px-5 text-base">
					<Camera class="size-[18px]" aria-hidden="true" /> Scan My Puzzle
				</a>
				<button class="btn btn-secondary h-12 px-5 text-base" onclick={trySample} disabled={starting}>
					{starting ? 'Opening sample…' : 'Try Sample Puzzle'}
					<ArrowRight class="size-[18px]" aria-hidden="true" />
				</button>
			</div>
			<p class="text-muted mt-5 text-[0.8125rem]">No account needed. Your photo is deleted within a day, or right away if you ask.</p>
		</div>
		<div class="pb-6 lg:pb-0">
			<SamplePreview />
		</div>
	</section>

	<section class="border-line/70 border-t">
		<div class="mx-auto grid max-w-[1200px] gap-6 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:items-start">
			<h2 class="max-w-[28rem] text-[1.875rem] leading-[2.375rem] font-semibold tracking-[-0.025em]">For the moment you get stuck.</h2>
			<p class="text-muted max-w-[38rem] text-[1.125rem] leading-8">
				You want the satisfaction of finishing the puzzle yourself, yet you keep searching the same pile of pieces. PuzzleAR helps you find the next step when you need it, and leaves the fun part, putting it together, to you.
			</p>
		</div>
	</section>

	<section id="how" class="border-line/70 border-t bg-[#fbfaf6]/70">
		<div class="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
			<h2 class="max-w-[36rem] text-[1.875rem] leading-[2.375rem] font-semibold tracking-[-0.025em]">Three steps, starting from one photo.</h2>
			<ol class="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
				<li>
					<svg viewBox="0 0 240 150" class="w-full max-w-[300px]" aria-hidden="true">
						<rect x="8" y="10" width="224" height="132" rx="14" fill="#2f4a3e" />
						<g fill="#2fb39f" fill-opacity=".18" stroke="#7fe0d0" stroke-width="2" stroke-linejoin="round">
							<path d="M40 40h22a8 8 0 1 1 14 0h22v22a8 8 0 1 0 0 14v22H76a8 8 0 1 1-14 0H40z" transform="rotate(-12 69 69)" />
							<path d="M130 34h22a8 8 0 1 0 14 0h22v22a8 8 0 1 1 0 14v22h-58V70a8 8 0 1 0 0-14z" transform="rotate(18 159 63)" />
							<path d="M92 92h22a8 8 0 1 1 14 0h22v40H92z" transform="rotate(6 121 112)" />
						</g>
						<g font-size="11" font-weight="650" text-anchor="middle" style="font-variant-numeric: tabular-nums">
							<rect x="57" y="60" width="24" height="17" rx="4" fill="#24312d" /><text x="69" y="72.5" fill="#fff">01</text>
							<rect x="147" y="54" width="24" height="17" rx="4" fill="#24312d" /><text x="159" y="66.5" fill="#fff">02</text>
							<rect x="109" y="104" width="24" height="17" rx="4" fill="#24312d" /><text x="121" y="116.5" fill="#fff">03</text>
						</g>
					</svg>
					<h3 class="mt-5 text-[1.125rem] font-semibold">1. Snap a photo</h3>
					<p class="text-muted mt-1.5 max-w-[22rem]">Spread the pieces out and take one photo from above. Every piece gets a number you can spot on the table.</p>
				</li>
				<li>
					<svg viewBox="0 0 240 150" class="w-full max-w-[300px]" aria-hidden="true">
						<rect x="8" y="10" width="224" height="132" rx="14" fill="#2f4a3e" />
						<g fill="#f2cc8f" opacity=".55">
							<rect x="34" y="36" width="26" height="26" rx="3" transform="rotate(-14 47 49)" />
							<rect x="82" y="96" width="26" height="26" rx="3" transform="rotate(22 95 109)" />
							<rect x="180" y="34" width="26" height="26" rx="3" transform="rotate(8 193 47)" />
							<rect x="176" y="96" width="26" height="26" rx="3" transform="rotate(-25 189 109)" />
						</g>
						<rect x="112" y="48" width="34" height="34" rx="4" fill="#e07a5f" transform="rotate(12 129 65)" />
						<rect x="104" y="40" width="50" height="50" rx="10" fill="none" stroke="#fff" stroke-width="3" transform="rotate(12 129 65)" />
						<rect x="102" y="100" width="56" height="22" rx="11" fill="#fff" />
						<text x="130" y="115" font-size="11" font-weight="650" text-anchor="middle" fill="#24312d">Next: #07</text>
					</svg>
					<h3 class="mt-5 text-[1.125rem] font-semibold">2. Find your next piece</h3>
					<p class="text-muted mt-1.5 max-w-[22rem]">PuzzleAR suggests which piece to pick up next and which pieces it joins, so you are not left staring at the pile.</p>
				</li>
				<li>
					<svg viewBox="0 0 240 150" class="w-full max-w-[300px]" aria-hidden="true">
						<rect x="8" y="10" width="224" height="132" rx="14" fill="#d8c39b" />
						<rect x="66" y="30" width="108" height="92" rx="3" fill="none" stroke="#5a4a32" stroke-opacity=".5" stroke-dasharray="5 4" stroke-width="1.5" />
						<rect x="66" y="30" width="36" height="46" fill="#e07a5f" opacity=".9" />
						<rect x="102" y="30" width="36" height="46" fill="#f2cc8f" opacity=".9" />
						<rect x="138" y="30" width="36" height="46" rx="2" fill="#fff" fill-opacity=".35" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 3" />
						<path d="M196 112c-10-22-24-30-40-34" fill="none" stroke="#24312d" stroke-width="1.5" stroke-dasharray="3 4" marker-end="url(#arr)" />
						<defs><marker id="arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0l8 4-8 4z" fill="#24312d" /></marker></defs>
					</svg>
					<h3 class="mt-5 text-[1.125rem] font-semibold">3. Place it with guidance</h3>
					<p class="text-muted mt-1.5 max-w-[22rem]">See where it goes, drawn right on the photo of your table. Check the move with a new photo, or confirm it yourself.</p>
				</li>
			</ol>
		</div>
	</section>

	<section class="mx-auto grid max-w-[1200px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
		<div>
			<h2 class="text-[1.5rem] leading-8 font-semibold tracking-[-0.02em]">How Meta SAM 3.1 makes it work</h2>
			<p class="text-muted mt-3 max-w-[34rem] text-[1.0625rem] leading-7">
				Meta SAM 3.1 helps PuzzleAR see individual pieces. Our matching engine turns those outlines into possible fits, and visual guidance helps you act on them.
			</p>
		</div>
		<div>
			<h2 class="text-[1.5rem] leading-8 font-semibold tracking-[-0.02em]">You stay in control</h2>
			<p class="text-muted mt-3 max-w-[34rem] text-[1.0625rem] leading-7">
				Inspect a suggested fit, confirm what works, and let PuzzleAR update the next steps. Fits you confirm are kept, and suggestions that need a closer look are marked as such.
			</p>
			<div class="mt-4 flex flex-wrap gap-2">
				<span class="chip bg-teal-soft text-teal"><CircleDot class="size-3.5" aria-hidden="true" />Strong candidate</span>
				<span class="chip bg-amber-soft text-amber-ink"><ScanSearch class="size-3.5" aria-hidden="true" />Needs a check</span>
				<span class="chip bg-verified-soft text-verified"><BadgeCheck class="size-3.5" aria-hidden="true" />Confirmed by you</span>
			</div>
		</div>
	</section>

	<section class="border-line/70 border-t bg-[#fbfaf6]/70">
		<div class="mx-auto flex max-w-[1200px] flex-col items-start gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
			<div class="max-w-[40rem]">
				<p class="text-[1.25rem] leading-8 font-semibold tracking-[-0.015em]">
					In our tests, a phone-style photo of 24 scattered pieces, shot at an angle, came back as the right picture, cell for cell.
				</p>
				<p class="text-muted mt-2 text-[0.875rem]">Rendered test puzzle, outlined by Meta SAM 3.1. Details in the project README.</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<button class="btn btn-primary h-12 px-5 text-base" onclick={trySample} disabled={starting}>Try Sample Puzzle <ArrowRight class="size-[18px]" aria-hidden="true" /></button>
				<a href="/new" class="btn btn-secondary h-12 px-5 text-base"><Camera class="size-[18px]" aria-hidden="true" /> Scan My Puzzle</a>
			</div>
		</div>
	</section>
</main>

<footer class="border-line/70 border-t">
	<div class="text-muted mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-[0.8125rem] sm:px-6">
		<span>Powered by Meta SAM 3.1</span>
		<a href="/privacy" class="hover:text-ink underline">Privacy &amp; data</a>
		<span class="ml-auto">Built for the Meta Global AI Developer Hackathon</span>
	</div>
</footer>
