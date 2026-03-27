import { describe, it, expect } from 'vitest';
import { Evaluator, type CallHandler, type EvalResult, type EvalEnv } from './evaluator';
import { TypeRegistry, primitiveType, pointerType, sizeOf, alignOf, defaultValue } from './types-c';
import type { ASTNode, CType, CValue } from './types';

/** Lightweight EvalEnv for tests — no Memory/Environment dependency needed. */
function makeEvalEnv(): EvalEnv & { declareVariable(name: string, type: CType, data: number): CValue } {
	const symbols = new Map<string, CValue>();
	let stackPointer = 0x7FFC0000;

	return {
		lookupVariable(name: string): CValue | undefined {
			return symbols.get(name);
		},
		setVariable(name: string, data: number | null): void {
			const v = symbols.get(name);
			if (!v) throw new Error(`Variable '${name}' not found`);
			v.data = data;
			v.initialized = true;
		},
		declareVariable(name: string, type: CType, data: number): CValue {
			const size = sizeOf(type);
			const alignment = alignOf(type);
			stackPointer = Math.floor((stackPointer - size) / alignment) * alignment;
			const value: CValue = { type, data, address: stackPointer, initialized: true };
			symbols.set(name, value);
			return value;
		},
	};
}

function setup(vars?: Record<string, { type: string; value: number }>) {
	const env = makeEvalEnv();
	const typeReg = new TypeRegistry();

	if (vars) {
		for (const [name, { type, value }] of Object.entries(vars)) {
			env.declareVariable(name, primitiveType(type), value);
		}
	}

	const evaluator = new Evaluator(env, typeReg);
	return { env, typeReg, evaluator };
}

function num(value: number, line = 1): ASTNode {
	return { type: 'number_literal', value, line };
}

function id(name: string, line = 1): ASTNode {
	return { type: 'identifier', name, line };
}

function binop(op: string, left: ASTNode, right: ASTNode, line = 1): ASTNode {
	return { type: 'binary_expression', operator: op, left, right, line };
}

function unop(op: string, operand: ASTNode, prefix = true, line = 1): ASTNode {
	return { type: 'unary_expression', operator: op, operand, prefix, line };
}

function assign(target: ASTNode, value: ASTNode, op = '=', line = 1): ASTNode {
	return { type: 'assignment', target, operator: op, value, line };
}

describe('arithmetic', () => {
	it('evaluates integer literal', () => {
		const { evaluator } = setup();
		const result = evaluator.eval(num(42));
		expect(result.value.data).toBe(42);
	});

	it('evaluates addition', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('+', num(3), num(4))).value.data).toBe(7);
	});

	it('evaluates subtraction', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('-', num(10), num(3))).value.data).toBe(7);
	});

	it('evaluates multiplication', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('*', num(6), num(7))).value.data).toBe(42);
	});

	it('evaluates division (truncated)', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('/', num(7), num(2))).value.data).toBe(3);
	});

	it('evaluates modulo', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('%', num(7), num(3))).value.data).toBe(1);
	});

	it('respects operator precedence via nesting: 3 + 4 * 2 = 11', () => {
		const { evaluator } = setup();
		// Parser produces: binop('+', 3, binop('*', 4, 2))
		const expr = binop('+', num(3), binop('*', num(4), num(2)));
		expect(evaluator.eval(expr).value.data).toBe(11);
	});

	it('evaluates negative numbers', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(unop('-', num(5))).value.data).toBe(-5);
	});

	it('evaluates nested arithmetic: (-10)*(-10) + (-20)*(-20) = 500', () => {
		const { evaluator } = setup();
		const expr = binop('+',
			binop('*', unop('-', num(10)), unop('-', num(10))),
			binop('*', unop('-', num(20)), unop('-', num(20))),
		);
		expect(evaluator.eval(expr).value.data).toBe(500);
	});
});

describe('comparison', () => {
	it('less than', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('<', num(3), num(5))).value.data).toBe(1);
		expect(evaluator.eval(binop('<', num(5), num(3))).value.data).toBe(0);
	});

	it('greater than', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('>', num(5), num(3))).value.data).toBe(1);
	});

	it('less than or equal', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('<=', num(3), num(3))).value.data).toBe(1);
	});

	it('equality', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('==', num(5), num(5))).value.data).toBe(1);
		expect(evaluator.eval(binop('!=', num(5), num(3))).value.data).toBe(1);
	});
});

describe('logical operators', () => {
	it('logical AND with short circuit (true && true)', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('&&', num(1), num(1))).value.data).toBe(1);
	});

	it('logical AND short circuits on false', () => {
		const { evaluator } = setup();
		// 0 && (anything) should not evaluate right side
		expect(evaluator.eval(binop('&&', num(0), num(1))).value.data).toBe(0);
	});

	it('logical OR with short circuit', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('||', num(1), num(0))).value.data).toBe(1);
	});

	it('logical OR short circuits on true', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('||', num(1), num(0))).value.data).toBe(1);
	});

	it('logical NOT', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(unop('!', num(0))).value.data).toBe(1);
		expect(evaluator.eval(unop('!', num(5))).value.data).toBe(0);
	});
});

describe('bitwise operators', () => {
	it('bitwise AND', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('&', num(0b1100), num(0b1010))).value.data).toBe(0b1000);
	});

	it('bitwise OR', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('|', num(0b1100), num(0b1010))).value.data).toBe(0b1110);
	});

	it('bitwise XOR', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('^', num(0b1100), num(0b1010))).value.data).toBe(0b0110);
	});

	it('bitwise NOT', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(unop('~', num(0))).value.data).toBe(-1);
	});

	it('left shift', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('<<', num(1), num(4))).value.data).toBe(16);
	});

	it('right shift', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('>>', num(16), num(4))).value.data).toBe(1);
	});
});

describe('variables', () => {
	it('reads variable value', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 42 } });
		expect(evaluator.eval(id('x')).value.data).toBe(42);
	});

	it('reports error for undefined variable', () => {
		const { evaluator } = setup();
		const result = evaluator.eval(id('nope'));
		expect(result.error).toContain('Undefined variable');
	});
});

describe('assignment', () => {
	it('simple assignment', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 0 } });
		evaluator.eval(assign(id('x'), num(42)));
		expect(evaluator.eval(id('x')).value.data).toBe(42);
	});

	it('compound assignment +=', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 10 } });
		evaluator.eval(assign(id('x'), num(5), '+='));
		expect(evaluator.eval(id('x')).value.data).toBe(15);
	});

	it('compound assignment -=', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 10 } });
		evaluator.eval(assign(id('x'), num(3), '-='));
		expect(evaluator.eval(id('x')).value.data).toBe(7);
	});

	it('compound assignment *=', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 4 } });
		evaluator.eval(assign(id('x'), num(3), '*='));
		expect(evaluator.eval(id('x')).value.data).toBe(12);
	});

	it('assignment to undefined variable errors', () => {
		const { evaluator } = setup();
		const result = evaluator.eval(assign(id('nope'), num(1)));
		expect(result.error).toContain('Undefined variable');
	});
});

describe('increment/decrement', () => {
	it('prefix increment', () => {
		const { evaluator } = setup({ i: { type: 'int', value: 3 } });
		const result = evaluator.eval(unop('++', id('i'), true));
		expect(result.value.data).toBe(4);
		expect(evaluator.eval(id('i')).value.data).toBe(4);
	});

	it('postfix increment', () => {
		const { evaluator } = setup({ i: { type: 'int', value: 3 } });
		const result = evaluator.eval(unop('++', id('i'), false));
		expect(result.value.data).toBe(3); // returns old value
		expect(evaluator.eval(id('i')).value.data).toBe(4); // but increments
	});

	it('prefix decrement', () => {
		const { evaluator } = setup({ i: { type: 'int', value: 3 } });
		const result = evaluator.eval(unop('--', id('i'), true));
		expect(result.value.data).toBe(2);
	});
});

describe('division by zero', () => {
	it('division by zero returns error', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('/', num(10), num(0))).error).toContain('Division by zero');
	});

	it('modulo by zero returns error', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('%', num(10), num(0))).error).toContain('Division by zero');
	});
});

describe('sizeof', () => {
	it('sizeof(int) = 4', () => {
		const { evaluator } = setup();
		const node: ASTNode = { type: 'sizeof_expression', targetType: { base: 'int', pointer: 0 }, line: 1 };
		expect(evaluator.eval(node).value.data).toBe(4);
	});

	it('sizeof(double) = 8', () => {
		const { evaluator } = setup();
		const node: ASTNode = { type: 'sizeof_expression', targetType: { base: 'double', pointer: 0 }, line: 1 };
		expect(evaluator.eval(node).value.data).toBe(8);
	});

	it('sizeof(int*) = 4', () => {
		const { evaluator } = setup();
		const node: ASTNode = { type: 'sizeof_expression', targetType: { base: 'int', pointer: 1 }, line: 1 };
		expect(evaluator.eval(node).value.data).toBe(4);
	});
});

describe('conditional (ternary)', () => {
	it('returns consequent when true', () => {
		const { evaluator } = setup();
		const node: ASTNode = {
			type: 'conditional_expression',
			condition: num(1),
			consequent: num(10),
			alternate: num(20),
			line: 1,
		};
		expect(evaluator.eval(node).value.data).toBe(10);
	});

	it('returns alternate when false', () => {
		const { evaluator } = setup();
		const node: ASTNode = {
			type: 'conditional_expression',
			condition: num(0),
			consequent: num(10),
			alternate: num(20),
			line: 1,
		};
		expect(evaluator.eval(node).value.data).toBe(20);
	});
});

describe('call expression', () => {
	it('calls handler with evaluated args', () => {
		const env = makeEvalEnv();
		const typeReg = new TypeRegistry();
		const handler: CallHandler = (name, args) => ({
			value: { type: primitiveType('int'), data: (args[0].data ?? 0) + (args[1].data ?? 0), address: 0 },
		});
		const evaluator = new Evaluator(env, typeReg, handler);
		const node: ASTNode = {
			type: 'call_expression',
			callee: 'add',
			args: [num(3), num(4)],
			line: 1,
		};
		expect(evaluator.eval(node).value.data).toBe(7);
	});

	it('returns error without handler', () => {
		const { evaluator } = setup();
		const node: ASTNode = {
			type: 'call_expression',
			callee: 'foo',
			args: [],
			line: 1,
		};
		expect(evaluator.eval(node).error).toContain('No call handler');
	});
});

describe('access path building', () => {
	it('builds path for simple identifier', () => {
		expect(Evaluator.buildAccessPath(id('x'))).toEqual(['x']);
	});

	it('builds path for member expression', () => {
		const node: ASTNode = {
			type: 'member_expression',
			object: id('p'),
			field: 'x',
			arrow: true,
			line: 1,
		};
		expect(Evaluator.buildAccessPath(node)).toEqual(['p', 'x']);
	});

	it('builds path for nested member expression', () => {
		const node: ASTNode = {
			type: 'member_expression',
			object: {
				type: 'member_expression',
				object: id('p'),
				field: 'pos',
				arrow: true,
				line: 1,
			},
			field: 'x',
			arrow: false,
			line: 1,
		};
		expect(Evaluator.buildAccessPath(node)).toEqual(['p', 'pos', 'x']);
	});
});

describe('null literal', () => {
	it('evaluates NULL to 0', () => {
		const { evaluator } = setup();
		expect(evaluator.eval({ type: 'null_literal', line: 1 }).value.data).toBe(0);
	});
});

// === C1: 32-bit integer wrapping ===

describe('32-bit integer wrapping', () => {
	it('INT_MAX + 1 wraps to INT_MIN', () => {
		const { evaluator } = setup();
		// 2147483647 + 1 = -2147483648 in 32-bit signed
		expect(evaluator.eval(binop('+', num(2147483647), num(1))).value.data).toBe(-2147483648);
	});

	it('INT_MIN - 1 wraps to INT_MAX', () => {
		const { evaluator } = setup();
		expect(evaluator.eval(binop('-', num(-2147483648), num(1))).value.data).toBe(2147483647);
	});

	it('large multiplication wraps', () => {
		const { evaluator } = setup();
		// 100000 * 100000 = 10000000000, which wraps to 1410065408 in 32-bit
		expect(evaluator.eval(binop('*', num(100000), num(100000))).value.data).toBe(1410065408);
	});

	it('unary negation of INT_MIN wraps to INT_MIN', () => {
		const { evaluator } = setup({ x: { type: 'int', value: -2147483648 } });
		expect(evaluator.eval(unop('-', id('x'))).value.data).toBe(-2147483648);
	});

	it('prefix increment wraps at INT_MAX', () => {
		const { evaluator } = setup({ i: { type: 'int', value: 2147483647 } });
		const result = evaluator.eval(unop('++', id('i'), true));
		expect(result.value.data).toBe(-2147483648);
	});
});

// === C2: Pointer increment scales by sizeof(*ptr) ===

describe('pointer increment scaling', () => {
	it('++p on int* advances by 4', () => {
		const env = makeEvalEnv();
		const typeReg = new TypeRegistry();
		env.declareVariable('p', pointerType(primitiveType('int')), 0x1000);
		const evaluator = new Evaluator(env, typeReg);

		evaluator.eval(unop('++', id('p'), true));
		expect(env.lookupVariable('p')?.data).toBe(0x1004);
	});

	it('p-- on int* decreases by 4', () => {
		const env = makeEvalEnv();
		const typeReg = new TypeRegistry();
		env.declareVariable('p', pointerType(primitiveType('int')), 0x1000);
		const evaluator = new Evaluator(env, typeReg);

		evaluator.eval(unop('--', id('p'), true));
		expect(env.lookupVariable('p')?.data).toBe(0x0FFC);
	});

	it('++p on char* advances by 1', () => {
		const env = makeEvalEnv();
		const typeReg = new TypeRegistry();
		env.declareVariable('p', pointerType(primitiveType('char')), 0x1000);
		const evaluator = new Evaluator(env, typeReg);

		evaluator.eval(unop('++', id('p'), true));
		expect(env.lookupVariable('p')?.data).toBe(0x1001);
	});
});

// === C4: Compound assignment operators ===

describe('compound bitwise assignment', () => {
	it('x &= 0xFF', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 0x1234 } });
		evaluator.eval(assign(id('x'), num(0xFF), '&='));
		expect(evaluator.eval(id('x')).value.data).toBe(0x34);
	});

	it('x |= 0xF0', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 0x0A } });
		evaluator.eval(assign(id('x'), num(0xF0), '|='));
		expect(evaluator.eval(id('x')).value.data).toBe(0xFA);
	});

	it('x ^= 0xFF', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 0xAA } });
		evaluator.eval(assign(id('x'), num(0xFF), '^='));
		expect(evaluator.eval(id('x')).value.data).toBe(0x55);
	});

	it('x <<= 4', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 1 } });
		evaluator.eval(assign(id('x'), num(4), '<<='));
		expect(evaluator.eval(id('x')).value.data).toBe(16);
	});

	it('x >>= 2', () => {
		const { evaluator } = setup({ x: { type: 'int', value: 16 } });
		evaluator.eval(assign(id('x'), num(2), '>>='));
		expect(evaluator.eval(id('x')).value.data).toBe(4);
	});
});
