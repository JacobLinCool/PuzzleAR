<script lang="ts">
	import { dismiss, toasts } from '$lib/client/toasts.svelte';
	import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '@lucide/svelte';

	const icons = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };
	const tones = {
		info: 'text-ink',
		success: 'text-verified',
		warning: 'text-amber-ink',
		error: 'text-error'
	};
</script>

<div
	class="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-50 flex flex-col items-center gap-2 px-4 lg:top-auto lg:bottom-6"
	aria-live="polite"
	role="status"
>
	{#each toasts as t (t.id)}
		{@const Icon = icons[t.tone]}
		<div
			class="card pointer-events-auto flex w-full max-w-md items-start gap-3 px-4 py-3 shadow-[var(--shadow-lift)]"
			style="animation: rise 220ms var(--ease-out-expo)"
		>
			<Icon class="mt-0.5 size-[18px] shrink-0 {tones[t.tone]}" aria-hidden="true" />
			<p class="flex-1 text-[0.875rem] leading-5">{t.message}</p>
			{#if t.action}
				<button
					class="text-teal hover:text-teal-hover text-[0.875rem] font-semibold"
					onclick={() => {
						t.action?.run();
						dismiss(t.id);
					}}>{t.action.label}</button
				>
			{/if}
			<button class="text-muted hover:text-ink -mr-1 rounded p-0.5" onclick={() => dismiss(t.id)} aria-label="Dismiss">
				<X class="size-4" />
			</button>
		</div>
	{/each}
</div>
