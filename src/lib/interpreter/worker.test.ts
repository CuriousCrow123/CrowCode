import { describe, it, expect, beforeAll } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { interpretSync, resetParserCache } from './index';
import type { WorkerRequest, WorkerResponse } from './worker';

let parser: Parser;

beforeAll(async () => {
	resetParserCache();
	await Parser.init({
		locateFile: () => resolve('static/tree-sitter.wasm'),
	});
	parser = new Parser();
	const lang = await Language.load(resolve('static/tree-sitter-c.wasm'));
	parser.setLanguage(lang);
});

describe('worker message contract', () => {
	it('success response has correct shape', () => {
		const source = 'int main() { int x = 5; return 0; }';
		const { program, errors } = interpretSync(parser, source);

		const response: WorkerResponse = { type: 'result', program, errors };
		expect(response.type).toBe('result');
		if (response.type === 'result') {
			expect(response.program.name).toBeDefined();
			expect(response.program.source).toBe(source);
			expect(response.program.steps).toBeInstanceOf(Array);
			expect(response.errors).toBeInstanceOf(Array);
		}
	});

	it('error response has correct shape', () => {
		const response: WorkerResponse = { type: 'error', message: 'Something went wrong' };
		expect(response.type).toBe('error');
		if (response.type === 'error') {
			expect(response.message).toBe('Something went wrong');
		}
	});

	it('request has correct shape', () => {
		const request: WorkerRequest = {
			type: 'interpret',
			source: 'int main() { return 0; }',
			options: { maxSteps: 100 },
		};
		expect(request.type).toBe('interpret');
		expect(request.source).toBeDefined();
		expect(request.options?.maxSteps).toBe(100);
	});
});

describe('worker-like interpretation', () => {
	it('processes valid C source', () => {
		const source = 'int main() { int x = 42; return 0; }';
		const result = interpretSync(parser, source);
		expect(result.program.steps.length).toBeGreaterThan(0);
		expect(result.errors).toHaveLength(0);
	});

	it('handles syntax errors gracefully', () => {
		const source = 'int main( { return 0; }';
		const result = interpretSync(parser, source);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it('respects maxSteps option', () => {
		const source = `int main() {
			for (int i = 0; i < 1000; i++) {
				int x = i;
			}
			return 0;
		}`;
		const result = interpretSync(parser, source, { maxSteps: 15 });
		expect(result.errors.some((e) => e.includes('Step limit'))).toBe(true);
	});
});
