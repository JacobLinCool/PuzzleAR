export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
	id: number;
	tone: ToastTone;
	message: string;
	action?: { label: string; run: () => void };
}

let next = 1;
export const toasts = $state<Toast[]>([]);

export function toast(message: string, tone: ToastTone = 'info', action?: Toast['action'], ms = 5200) {
	const id = next++;
	toasts.push({ id, tone, message, action });
	// keep the stack short: a burst of actions should not bury the screen
	while (toasts.length > 2) toasts.shift();
	if (ms > 0) setTimeout(() => dismiss(id), ms);
	return id;
}

export function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}
