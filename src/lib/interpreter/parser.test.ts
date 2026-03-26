import { describe, it, expect, beforeAll } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { parseSource, initTreeSitter, resetParserCache } from './parser';
import type { ASTNode } from './types';

let parser: typeof Parser.prototype;

beforeAll(async () => {
	resetParserCache();
	parser = await initTreeSitter(
		resolve('static/tree-sitter.wasm'),
		resolve('static/tree-sitter-c.wasm'),
	);
});

function parse(source: string) {
	return parseSource(parser, source);
}

function firstChild(source: string): ASTNode {
	const { result } = parse(source);
	return result.children[0];
}

describe('tree-sitter initialization', () => {
	it('initializes and parses a minimal C program', () => {
		const { result } = parse('int main() { return 0; }');
		expect(result.type).toBe('translation_unit');
		expect(result.children.length).toBeGreaterThan(0);
	});
});

describe('function definitions', () => {
	it('parses main function', () => {
		const node = firstChild('int main() { return 0; }');
		expect(node.type).toBe('function_definition');
		if (node.type === 'function_definition') {
			expect(node.name).toBe('main');
			expect(node.returnType.base).toBe('int');
			expect(node.params).toHaveLength(0);
		}
	});

	it('parses function with parameters', () => {
		const node = firstChild('int add(int a, int b) { return a + b; }');
		if (node.type === 'function_definition') {
			expect(node.name).toBe('add');
			expect(node.params).toHaveLength(2);
			expect(node.params[0].name).toBe('a');
			expect(node.params[0].typeSpec.base).toBe('int');
			expect(node.params[1].name).toBe('b');
		}
	});

	it('parses function with pointer return type', () => {
		const node = firstChild('int* getPtr() { return 0; }');
		if (node.type === 'function_definition') {
			expect(node.returnType.pointer).toBe(1);
		}
	});

	it('parses function with struct parameter', () => {
		const src = 'struct Point { int x; int y; };\nint dist(struct Point a) { return a.x; }';
		const { result } = parse(src);
		const fn = result.children.find((c) => c.type === 'function_definition');
		if (fn?.type === 'function_definition') {
			expect(fn.params[0].typeSpec.base).toBe('struct');
			expect(fn.params[0].typeSpec.structName).toBe('Point');
		}
	});

	it('parses void function with no params', () => {
		const node = firstChild('void setup() {}');
		if (node.type === 'function_definition') {
			expect(node.name).toBe('setup');
			expect(node.returnType.base).toBe('void');
			expect(node.params).toHaveLength(0);
		}
	});
});

describe('declarations', () => {
	it('parses simple variable declaration', () => {
		const { result } = parse('int main() { int x = 5; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			expect(decl.type).toBe('declaration');
			if (decl.type === 'declaration') {
				expect(decl.name).toBe('x');
				expect(decl.declType.base).toBe('int');
				expect(decl.initializer?.type).toBe('number_literal');
			}
		}
	});

	it('parses pointer declaration', () => {
		const { result } = parse('int main() { int *p = 0; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration') {
				expect(decl.declType.pointer).toBe(1);
			}
		}
	});

	it('parses array declaration', () => {
		const { result } = parse('int main() { int arr[4] = {1, 2, 3, 4}; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration') {
				expect(decl.declType.array).toBe(4);
				expect(decl.initializer?.type).toBe('init_list');
			}
		}
	});

	it('parses struct declaration with initializer', () => {
		const src = 'struct Point { int x; int y; };\nint main() { struct Point p = {1, 2}; }';
		const { result } = parse(src);
		const fn = result.children.find((c) => c.type === 'function_definition');
		if (fn?.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration') {
				expect(decl.declType.structName).toBe('Point');
			}
		}
	});

	it('parses declaration without initializer', () => {
		const { result } = parse('int main() { int x; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration') {
				expect(decl.initializer).toBeUndefined();
			}
		}
	});
});

describe('struct definitions', () => {
	it('parses struct with fields', () => {
		const node = firstChild('struct Point { int x; int y; };');
		expect(node.type).toBe('struct_definition');
		if (node.type === 'struct_definition') {
			expect(node.name).toBe('Point');
			expect(node.fields).toHaveLength(2);
			expect(node.fields[0].name).toBe('x');
			expect(node.fields[1].name).toBe('y');
		}
	});

	it('parses nested struct reference', () => {
		const src = 'struct Point { int x; int y; };\nstruct Player { int id; struct Point pos; };';
		const { result } = parse(src);
		const player = result.children[1];
		if (player.type === 'struct_definition') {
			expect(player.fields[1].typeSpec.structName).toBe('Point');
		}
	});
});

describe('expressions', () => {
	it('parses binary arithmetic', () => {
		const { result } = parse('int main() { int x = 3 + 4 * 2; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration' && decl.initializer) {
				expect(decl.initializer.type).toBe('binary_expression');
			}
		}
	});

	it('parses function calls', () => {
		const { result } = parse('int main() { int x = foo(1, 2); }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration' && decl.initializer?.type === 'call_expression') {
				expect(decl.initializer.callee).toBe('foo');
				expect(decl.initializer.args).toHaveLength(2);
			}
		}
	});

	it('parses member access (dot)', () => {
		const { result } = parse('int main() { int x = p.x; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration' && decl.initializer?.type === 'member_expression') {
				expect(decl.initializer.field).toBe('x');
				expect(decl.initializer.arrow).toBe(false);
			}
		}
	});

	it('parses member access (arrow)', () => {
		const { result } = parse('int main() { int x = p->x; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration' && decl.initializer?.type === 'member_expression') {
				expect(decl.initializer.field).toBe('x');
				expect(decl.initializer.arrow).toBe(true);
			}
		}
	});

	it('parses subscript expression', () => {
		const { result } = parse('int main() { int x = arr[2]; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration' && decl.initializer?.type === 'subscript_expression') {
				expect(decl.initializer.object.type).toBe('identifier');
			}
		}
	});

	it('parses unary expressions', () => {
		const { result } = parse('int main() { int x = -5; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration' && decl.initializer?.type === 'unary_expression') {
				expect(decl.initializer.operator).toBe('-');
			}
		}
	});

	it('parses address-of and dereference', () => {
		const { result } = parse('int main() { int *p = &x; int y = *p; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl0 = fn.body.children[0];
			if (decl0.type === 'declaration' && decl0.initializer?.type === 'unary_expression') {
				expect(decl0.initializer.operator).toBe('&');
			}
			const decl1 = fn.body.children[1];
			if (decl1.type === 'declaration' && decl1.initializer?.type === 'unary_expression') {
				expect(decl1.initializer.operator).toBe('*');
			}
		}
	});

	it('parses NULL literal', () => {
		const { result } = parse('int main() { int *p = NULL; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration') {
				expect(decl.initializer?.type).toBe('null_literal');
			}
		}
	});

	it('parses sizeof with type', () => {
		const { result } = parse('int main() { int x = sizeof(int); }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const decl = fn.body.children[0];
			if (decl.type === 'declaration' && decl.initializer) {
				expect(decl.initializer.type).toBe('sizeof_expression');
			}
		}
	});
});

describe('control flow', () => {
	it('parses for loop', () => {
		const { result } = parse('int main() { for (int i = 0; i < 10; i++) { } }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const loop = fn.body.children[0];
			expect(loop.type).toBe('for_statement');
			if (loop.type === 'for_statement') {
				expect(loop.init).toBeDefined();
				expect(loop.condition).toBeDefined();
				expect(loop.update).toBeDefined();
			}
		}
	});

	it('parses while loop', () => {
		const { result } = parse('int main() { while (x > 0) { x--; } }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const loop = fn.body.children[0];
			expect(loop.type).toBe('while_statement');
		}
	});

	it('parses do-while loop', () => {
		const { result } = parse('int main() { do { x++; } while (x < 10); }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const loop = fn.body.children[0];
			expect(loop.type).toBe('do_while_statement');
		}
	});

	it('parses if/else', () => {
		const { result } = parse('int main() { if (x > 0) { y = 1; } else { y = 2; } }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const stmt = fn.body.children[0];
			expect(stmt.type).toBe('if_statement');
			if (stmt.type === 'if_statement') {
				expect(stmt.alternate).toBeDefined();
			}
		}
	});

	it('parses break and continue', () => {
		const { result } = parse('int main() { while(1) { break; continue; } }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const loop = fn.body.children[0];
			if (loop.type === 'while_statement' && loop.body.type === 'compound_statement') {
				expect(loop.body.children[0].type).toBe('break_statement');
				expect(loop.body.children[1].type).toBe('continue_statement');
			}
		}
	});

	it('extracts for-loop column ranges', () => {
		const { result } = parse('int main() { for (int i = 0; i < 4; i++) {} }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const loop = fn.body.children[0];
			if (loop.type === 'for_statement') {
				expect(loop.condColStart).toBeDefined();
				expect(loop.condColEnd).toBeDefined();
				expect(loop.updateColStart).toBeDefined();
				expect(loop.updateColEnd).toBeDefined();
			}
		}
	});
});

describe('assignments', () => {
	it('parses simple assignment', () => {
		const { result } = parse('int main() { x = 5; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const stmt = fn.body.children[0];
			expect(stmt.type).toBe('assignment');
		}
	});

	it('parses compound assignment', () => {
		const { result } = parse('int main() { x += 5; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const stmt = fn.body.children[0];
			if (stmt.type === 'assignment') {
				expect(stmt.operator).toBe('+=');
			}
		}
	});

	it('parses field assignment', () => {
		const { result } = parse('int main() { p->x = 10; }');
		const fn = result.children[0];
		if (fn.type === 'function_definition' && fn.body.type === 'compound_statement') {
			const stmt = fn.body.children[0];
			if (stmt.type === 'assignment') {
				expect(stmt.target.type).toBe('member_expression');
			}
		}
	});
});

describe('preprocessor', () => {
	it('warns about #include but continues', () => {
		const { result, errors } = parse('#include <stdio.h>\nint main() { return 0; }');
		expect(errors.some((e) => e.includes('preprocessor'))).toBe(true);
		expect(result.children.some((c) => c.type === 'function_definition')).toBe(true);
	});
});

describe('error handling', () => {
	it('reports syntax errors', () => {
		const { errors } = parse('int main( { return 0; }');
		expect(errors.length).toBeGreaterThan(0);
	});

	it('parses the basics.ts source successfully', () => {
		const source = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct Point {
    int x;
    int y;
};

struct Player {
    int id;
    struct Point pos;
    int *scores;
};

int distance(struct Point a, struct Point b) {
    int dx = a.x - b.x;
    int dy = a.y - b.y;
    return dx * dx + dy * dy;
}

int main() {
    int count = 3;
    struct Point origin = {0, 0};

    struct Player *p = malloc(sizeof(struct Player));
    p->id = 1;
    p->pos.x = 10;
    p->pos.y = 20;

    p->scores = calloc(count, sizeof(int));
    p->scores[0] = 100;
    p->scores[1] = 200;
    p->scores[2] = 300;

    int d = distance(origin, p->pos);

    {
        char *msg = malloc(64);
        sprintf(msg, "dist=%d", d);
        printf("%s\\n", msg);
        free(msg);
    }

    free(p->scores);
    free(p);

    return 0;
}`;

		const { result, errors } = parse(source);
		// Should have preprocessor warnings but parse successfully
		const funcs = result.children.filter((c) => c.type === 'function_definition');
		expect(funcs.length).toBe(2); // distance + main
		const structs = result.children.filter((c) => c.type === 'struct_definition');
		expect(structs.length).toBe(2); // Point + Player
	});

	it('parses the loops.ts source successfully', () => {
		const source = `#include <stdio.h>
#include <stdlib.h>

int main() {
    int sum = 0;
    int arr[4] = {10, 20, 30, 40};

    for (int i = 0; i < 4; i++) {
        sum += arr[i];
    }

    int *squares = malloc(4 * sizeof(int));
    for (int j = 0; j < 4; j++) {
        squares[j] = arr[j] * arr[j];
    }

    int total = 0;
    for (int k = 0; k < 4; k++) {
        total += squares[k];
    }

    free(squares);
    return 0;
}`;

		const { result, errors } = parse(source);
		const funcs = result.children.filter((c) => c.type === 'function_definition');
		expect(funcs.length).toBe(1);
	});
});
