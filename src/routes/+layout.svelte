<script lang="ts">
	import './layout.css';
	import Toasts from '$lib/components/Toasts.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<meta name="theme-color" content="#F7F5F0" />
</svelte:head>

<!--
THESIS: The table is the interface. Every screen anchors to the real photo of the person's pieces; the app never replaces the puzzle with a virtual one.
OWN-WORLD: Warm ivory worktable ground with paper tooth, white cut-paper surfaces, deep-teal ink for die-cut piece outlines and actions, amber pencil-dash for anything uncertain, kraft for the assembly area. Numbered piece tags like price stickers.
STORY: See your pieces outlined and numbered, see which edges fit and why, then pick up the right piece and put it in the right place, confirming each step.
FIRST VIEWPORT: Left, headline and two actions; right, the sample photo itself with real SAM outlines: tap a piece and its neighbours light up.
FORM: PRD-pinned paper worktable (brief-pinned; no seed roll).
-->
<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-secondary">Skip to content</a>
{@render children()}
<Toasts />
