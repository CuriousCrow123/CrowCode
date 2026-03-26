import { describe, it, expect } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';

async function initParser(): Promise<Parser> {
	await Parser.init({
		locateFile: () => resolve('static/tree-sitter.wasm'),
	});
	const parser = new Parser();
	const lang = await Language.load(resolve('static/tree-sitter-c.wasm'));
	parser.setLanguage(lang);
	return parser;
}

describe('tree-sitter initialization', () => {
	it('initializes and parses a minimal C program', async () => {
		const parser = await initParser();
		const tree = parser.parse('int main() { return 0; }');
		expect(tree.rootNode.type).toBe('translation_unit');
		expect(tree.rootNode.childCount).toBeGreaterThan(0);
	});

	it('parses function definitions', async () => {
		const parser = await initParser();
		const tree = parser.parse('int add(int a, int b) { return a + b; }');
		const fn = tree.rootNode.firstChild!;
		expect(fn.type).toBe('function_definition');
	});

	it('parses struct definitions', async () => {
		const parser = await initParser();
		const tree = parser.parse('struct Point { int x; int y; };');
		const root = tree.rootNode;
		expect(root.text).toContain('struct Point');
	});
});
