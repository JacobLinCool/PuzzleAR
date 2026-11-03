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
	<title>PuzzleAR · A little help for the pieces that don't fit</title>
	<meta
		name="description"
		content="Turn a photo of scattered jigsaw pieces into step-by-step physical assembly guidance. No box image required. Powered by Meta SAM 3.1."
	/>
</svelte:head>

<SiteHeader />

<main id="main">
	<section class="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pt-6 pb-20 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-16 lg:pt-10 lg:pb-28">
		<div class="max-w-[34rem]" style="animation: rise 420ms var(--ease-out-expo) both">
			<h1 class="text-[2.5rem] leading-[1.06] font-semibold tracking-[-0.035em] sm:text-[3.25rem]">
				A little help for the pieces that don't fit.
			</h1>
			<p class="text-muted mt-5 max-w-[30rem] text-[1.0625rem] leading-7">
				Turn a photo of scattered pieces into step-by-step physical assembly guidance. No box image required.
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
			<p class="text-muted mt-5 text-[0.8125rem]">No account. Photos are deleted after 24 hours, or sooner if you ask.</p>
		</div>
		<div class="pb-6 lg:pb-0">
			<SamplePreview />
		</div>
	</section>

	<section id="how" class="border-line/70 border-t bg-[#fbfaf6]/70">
		<div class="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
			<h2 class="max-w-[36rem] text-[1.875rem] leading-[2.375rem] font-semibold tracking-[-0.025em]">
				You hold the pieces. PuzzleAR keeps track of where they go.
			</h2>
			<ol class="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
				<li class="group">
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
					<h3 class="mt-5 text-[1.125rem] font-semibold">Scan</h3>
					<p class="text-muted mt-1.5 max-w-[22rem]">
						Spread the pieces apart and take one photo from above. Meta SAM 3.1 outlines every piece and gives it a number you can see on the table.
					</p>
				</li>
				<li>
					<svg viewBox="0 0 240 150" class="w-full max-w-[300px]" aria-hidden="true">
						<rect x="8" y="10" width="224" height="132" rx="14" fill="#fff" stroke="#E5E6DF" />
						<path d="M30 76h50c0-14 26-14 26 0h20" fill="none" stroke="#167A6B" stroke-width="3" stroke-linecap="round" />
						<path d="M30 84h50c0 14 26 14 26 0h20" fill="none" stroke="#24312d" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 0" transform="translate(0 -6)" opacity=".35" />
						<path d="M138 70h60" stroke="#B97720" stroke-width="3" stroke-dasharray="4 5" stroke-linecap="round" />
						<path d="M138 88h60" stroke="#167A6B" stroke-width="3" stroke-linecap="round" />
						<circle cx="210" cy="70" r="5" fill="#f8eedf" stroke="#B97720" stroke-width="2" />
						<circle cx="210" cy="88" r="5" fill="#e3f0ed" stroke="#167A6B" stroke-width="2" />
						<text x="68" y="122" font-size="11" fill="#6A7770" text-anchor="middle">shape</text>
						<text x="168" y="122" font-size="11" fill="#6A7770" text-anchor="middle">color along the cut</text>
					</svg>
					<h3 class="mt-5 text-[1.125rem] font-semibold">Find the fit</h3>
					<p class="text-muted mt-1.5 max-w-[22rem]">
						Each edge is compared by its tab-and-socket shape and the colors along the cut. A solver proposes up to three full boards and marks the edges that need your eye.
					</p>
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
					<h3 class="mt-5 text-[1.125rem] font-semibold">Assemble together</h3>
					<p class="text-muted mt-1.5 max-w-[22rem]">
						“Pick up #07, place it at row 2, column 3.” Snap a photo to check it, or confirm by hand. Every step can be undone.
					</p>
				</li>
			</ol>
		</div>
	</section>

	<section class="mx-auto grid max-w-[1200px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:items-start">
		<h2 class="max-w-[28rem] text-[1.875rem] leading-[2.375rem] font-semibold tracking-[-0.025em]">
			Honest about what it knows.
		</h2>
		<div class="grid gap-6">
			<p class="text-muted max-w-[38rem] text-[1.0625rem] leading-7">
				Matching scores are rankings, not probabilities, so PuzzleAR never shows a “95% sure”. Every edge carries one of three plain labels, and a low-confidence check never marks a step as done.
			</p>
			<dl class="divide-line border-line divide-y border-y">
				<div class="flex items-start gap-4 py-4">
					<dt class="chip bg-teal-soft text-teal shrink-0"><CircleDot class="size-3.5" aria-hidden="true" />Strong candidate</dt>
					<dd class="text-muted">Both edges prefer each other, by a clear margin.</dd>
				</div>
				<div class="flex items-start gap-4 py-4">
					<dt class="chip bg-amber-soft text-amber-ink shrink-0"><ScanSearch class="size-3.5" aria-hidden="true" />Needs a check</dt>
					<dd class="text-muted">Another edge scores almost as well. Try it on the table and tell us: Fits, or Doesn't fit.</dd>
				</div>
				<div class="flex items-start gap-4 py-4">
					<dt class="chip bg-verified-soft text-verified shrink-0"><BadgeCheck class="size-3.5" aria-hidden="true" />Human-confirmed</dt>
					<dd class="text-muted">You said it fits. The solver keeps it locked from then on.</dd>
				</div>
			</dl>
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
