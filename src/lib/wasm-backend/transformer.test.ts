import { describe, it, expect, beforeAll } from 'vitest';
import { transformSource } from './transformer';
import type { Parser as ParserType } from 'web-tree-sitter';

let parser: ParserType;

beforeAll(async () => {
	const TreeSitter = await import('web-tree-sitter');
	await TreeSitter.Parser.init();
	parser = new TreeSitter.Parser();
	const lang = await TreeSitter.Language.load('static/tree-sitter-c.wasm');
	parser.setLanguage(lang);
});

describe('transformSource', () => {
	it('adds __crow.h include', () => {
		const { instrumented } = transformSource(parser, 'int main() { return 0; }');
		expect(instrumented).toMatch(/^#include "__crow\.h"/);
	});

	it('instruments a simple function with push/pop scope', () => {
		const source = `int main() {
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_push_scope("main"');
		expect(instrumented).toContain('__crow_pop_scope()');
	});

	it('instruments parameter declarations', () => {
		const source = `int add(int a, int b) {
	return a + b;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_decl("a", &a, sizeof(a), "int"');
		expect(instrumented).toContain('__crow_decl("b", &b, sizeof(b), "int"');
	});

	it('instruments variable declarations', () => {
		const source = `int main() {
	int x = 5;
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_decl("x", &x, sizeof(x), "int"');
		expect(instrumented).toContain('__crow_step(');
	});

	it('instruments assignments with __crow_set', () => {
		const source = `int main() {
	int x = 5;
	x = 10;
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_set("x", &x,');
	});

	it('instruments struct declarations', () => {
		const source = `struct Point { int x; int y; };
int main() {
	struct Point p = {1, 2};
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_decl("p", &p, sizeof(p), "struct Point"');
	});

	it('instruments array declarations', () => {
		const source = `int main() {
	int arr[5] = {1, 2, 3, 4, 5};
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_decl("arr", &arr, sizeof(arr), "int[5]"');
	});

	it('instruments pointer declarations', () => {
		const source = `int main() {
	int x = 5;
	int *p = &x;
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_decl("p", &p, sizeof(p), "int*"');
	});

	it('rewrites malloc calls', () => {
		const source = `int main() {
	int *p = (int*)malloc(sizeof(int) * 10);
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_malloc(');
		expect(instrumented).not.toMatch(/[^_]malloc\(/);
	});

	it('rewrites free calls', () => {
		const source = `int main() {
	int *p = (int*)malloc(16);
	free(p);
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_free(p,');
		expect(instrumented).not.toMatch(/[^_]free\(p\)/);
	});

	it('rewrites scanf calls', () => {
		const source = `int main() {
	int x;
	scanf("%d", &x);
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_scanf_int(&x,');
		expect(instrumented).not.toContain('scanf("%d"');
	});

	it('instruments for loops', () => {
		const source = `int main() {
	for (int i = 0; i < 10; i++) {
		int x = i;
	}
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_decl("i", &i, sizeof(i), "int"');
		expect(instrumented).toContain('__crow_set("i", &i,');
	});

	it('instruments if/else', () => {
		const source = `int main() {
	int x = 5;
	if (x > 3) {
		x = 10;
	} else {
		x = 0;
	}
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		// Should have steps for both branches
		expect(instrumented).toContain('__crow_step(');
	});

	it('instruments while loops', () => {
		const source = `int main() {
	int x = 0;
	while (x < 10) {
		x = x + 1;
	}
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_set("x", &x,');
	});

	it('handles function with no return', () => {
		const source = `void greet() {
	int x = 42;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_push_scope("greet"');
		expect(instrumented).toContain('__crow_pop_scope()');
	});

	it('adds pop_scope before every return', () => {
		const source = `int abs(int x) {
	if (x < 0) {
		return -x;
	}
	return x;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		// Should have __crow_pop_scope before each return
		const popCount = (instrumented.match(/__crow_pop_scope/g) || []).length;
		expect(popCount).toBeGreaterThanOrEqual(2);
	});

	it('reports parse errors', () => {
		const { errors } = transformSource(parser, 'int main( { }');
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain('Parse error');
	});

	it('handles multi-specifier scanf', () => {
		const source = `int main() {
	int x;
	float y;
	scanf("%d %f", &x, &y);
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_scanf_int');
		expect(instrumented).toContain('__crow_scanf_float');
	});

	it('preserves non-instrumented code structure', () => {
		const source = `#include <stdio.h>
// Comment
int main() {
	printf("hello");
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('#include <stdio.h>');
		expect(instrumented).toContain('// Comment');
		expect(instrumented).toContain('printf("hello")');
	});

	it('handles calloc rewrite', () => {
		const source = `int main() {
	int *p = (int*)calloc(10, sizeof(int));
	return 0;
}`;
		const { instrumented, errors } = transformSource(parser, source);
		expect(errors).toEqual([]);
		expect(instrumented).toContain('__crow_calloc(');
	});
});
