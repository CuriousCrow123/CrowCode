import { Parser, Language } from 'web-tree-sitter';
import { interpretSync } from './index';
import type { InterpreterOptions } from './types';
import type { Program } from '$lib/api/types';

// === Message Types ===

export type WorkerRequest = {
	type: 'interpret';
	source: string;
	options?: InterpreterOptions;
};

export type WorkerResponse =
	| { type: 'result'; program: Program; errors: string[] }
	| { type: 'error'; message: string };

// === Worker Entry ===

let parser: Parser | null = null;

async function initParser(): Promise<Parser> {
	if (parser) return parser;

	await Parser.init({
		locateFile: () => '/CrowTools/tree-sitter.wasm',
	});
	parser = new Parser();
	const lang = await Language.load('/CrowTools/tree-sitter-c.wasm');
	parser.setLanguage(lang);
	return parser;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const { type, source, options } = event.data;

	if (type !== 'interpret') {
		self.postMessage({ type: 'error', message: `Unknown request type: ${type}` } satisfies WorkerResponse);
		return;
	}

	try {
		const p = await initParser();
		const { program, errors } = interpretSync(p, source, options);
		self.postMessage({ type: 'result', program, errors } satisfies WorkerResponse);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		self.postMessage({ type: 'error', message } satisfies WorkerResponse);
	}
};
