/**
 * Turns a Server-Sent Events byte stream (as returned by the Responses API with
 * `stream: true`) into the structural event objects `@meta-sam/parser` reads.
 */
export async function* sseEvents(
	body: ReadableStream<Uint8Array>,
	onRaw?: (chunk: string) => void
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			onRaw?.(text);
			buffer += text;
			let sep: number;
			while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
				const block = buffer.slice(0, sep);
				buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
				const event = parseBlock(block);
				if (event) yield event;
			}
		}
		const tail = parseBlock(buffer + decoder.decode());
		if (tail) yield tail;
	} finally {
		reader.releaseLock();
	}
}

function parseBlock(block: string): { type: string; [key: string]: unknown } | null {
	const data = block
		.split(/\r?\n/)
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).replace(/^ /, ''))
		.join('\n');
	if (!data || data === '[DONE]') return null;
	try {
		const parsed = JSON.parse(data);
		return parsed && typeof parsed.type === 'string' ? parsed : null;
	} catch {
		return null;
	}
}
