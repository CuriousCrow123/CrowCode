import { describe, it, expect } from 'vitest';
import { Environment, formatAddress } from './environment';
import { primitiveType, pointerType, sizeOf } from './types-c';
import type { ASTNode } from './types';

function makeEnv(): Environment {
	const env = new Environment();
	env.pushScope('main');
	return env;
}

describe('scope chain', () => {
	it('pushScope creates nested scope', () => {
		const env = new Environment();
		env.pushScope('main');
		expect(env.scopeDepth()).toBe(1);
		env.pushScope('for1');
		expect(env.scopeDepth()).toBe(2);
	});

	it('popScope removes top scope', () => {
		const env = new Environment();
		env.pushScope('main');
		env.pushScope('block');
		env.popScope();
		expect(env.scopeDepth()).toBe(1);
	});

	it('currentScope returns top', () => {
		const env = new Environment();
		env.pushScope('main');
		env.pushScope('for1');
		expect(env.currentScope()?.name).toBe('for1');
	});

	it('popScope on empty returns undefined', () => {
		const env = new Environment();
		expect(env.popScope()).toBeUndefined();
	});
});

describe('variable management', () => {
	it('declares and looks up variable', () => {
		const env = makeEnv();
		const v = env.declareVariable('x', primitiveType('int'), 42);
		expect(v.data).toBe(42);
		expect(env.lookupVariable('x')?.data).toBe(42);
	});

	it('sets variable value', () => {
		const env = makeEnv();
		env.declareVariable('x', primitiveType('int'), 10);
		env.setVariable('x', 20);
		expect(env.lookupVariable('x')?.data).toBe(20);
	});

	it('variable shadowing in nested scope', () => {
		const env = makeEnv();
		env.declareVariable('x', primitiveType('int'), 1);
		env.pushScope('inner');
		env.declareVariable('x', primitiveType('int'), 2);
		expect(env.lookupVariable('x')?.data).toBe(2);
		env.popScope();
		expect(env.lookupVariable('x')?.data).toBe(1);
	});

	it('lookupVariable returns undefined for undeclared', () => {
		const env = makeEnv();
		expect(env.lookupVariable('nope')).toBeUndefined();
	});

	it('setVariable throws for undeclared', () => {
		const env = makeEnv();
		expect(() => env.setVariable('nope', 0)).toThrow("Variable 'nope' not found");
	});

	it('declares variable with default value when none given', () => {
		const env = makeEnv();
		const v = env.declareVariable('y', primitiveType('int'));
		expect(v.data).toBe(0);
	});
});

describe('stack address allocator', () => {
	it('allocates addresses that decrement', () => {
		const env = makeEnv();
		const v1 = env.declareVariable('a', primitiveType('int'), 0);
		const v2 = env.declareVariable('b', primitiveType('int'), 0);
		expect(v1.address).toBeGreaterThan(v2.address);
	});

	it('addresses are below stack base', () => {
		const env = makeEnv();
		const v = env.declareVariable('x', primitiveType('int'), 0);
		expect(v.address).toBeLessThanOrEqual(env.getStackBase());
	});

	it('addresses are aligned for type', () => {
		const env = makeEnv();
		const v = env.declareVariable('d', primitiveType('double'), 0);
		expect(v.address % 8).toBe(0);
	});

	it('saves and restores stack pointer', () => {
		const env = makeEnv();
		const sp = env.saveStackPointer();
		env.declareVariable('x', primitiveType('int'), 0);
		env.restoreStackPointer(sp);
		const v = env.declareVariable('y', primitiveType('int'), 0);
		// y should get the same address as x would have
		expect(v.address).toBe(sp - sizeOf(primitiveType('int')));
	});
});

describe('heap allocator', () => {
	it('malloc returns address above heap base', () => {
		const env = makeEnv();
		const { address } = env.malloc(16, 'malloc', 1);
		expect(address).toBeGreaterThanOrEqual(env.getHeapBase());
	});

	it('successive mallocs return different addresses', () => {
		const env = makeEnv();
		const a1 = env.malloc(16, 'malloc', 1);
		const a2 = env.malloc(16, 'malloc', 2);
		expect(a1.address).not.toBe(a2.address);
	});

	it('addresses increment', () => {
		const env = makeEnv();
		const a1 = env.malloc(16, 'malloc', 1);
		const a2 = env.malloc(16, 'malloc', 2);
		expect(a2.address).toBeGreaterThan(a1.address);
	});

	it('free marks block as freed', () => {
		const env = makeEnv();
		const { address } = env.malloc(16, 'malloc', 1);
		const result = env.free(address);
		expect(result.error).toBeUndefined();
		expect(env.getHeapBlock(address)?.status).toBe('freed');
	});

	it('double free returns error', () => {
		const env = makeEnv();
		const { address } = env.malloc(16, 'malloc', 1);
		env.free(address);
		const result = env.free(address);
		expect(result.error).toContain('double free');
	});

	it('free invalid pointer returns error', () => {
		const env = makeEnv();
		const result = env.free(0xDEADBEEF);
		expect(result.error).toContain('invalid pointer');
	});

	it('heap exhaustion returns error', () => {
		const env = new Environment(32);
		env.pushScope('main');
		env.malloc(16, 'malloc', 1);
		const result = env.malloc(32, 'malloc', 2);
		expect(result.error).toContain('Heap exhausted');
	});

	it('getHeapBlock returns block info', () => {
		const env = makeEnv();
		const { address } = env.malloc(64, 'calloc', 5);
		const block = env.getHeapBlock(address);
		expect(block?.size).toBe(64);
		expect(block?.allocator).toBe('calloc');
		expect(block?.allocSite.line).toBe(5);
		expect(block?.status).toBe('allocated');
	});
});

describe('function table', () => {
	it('defines and retrieves function', () => {
		const env = makeEnv();
		const fn = {
			type: 'function_definition' as const,
			name: 'add',
			returnType: { base: 'int', pointer: 0 },
			params: [],
			body: { type: 'compound_statement' as const, children: [], line: 1 },
			line: 1,
		};
		env.defineFunction('add', fn);
		expect(env.getFunction('add')).toBe(fn);
	});

	it('returns undefined for unknown function', () => {
		const env = makeEnv();
		expect(env.getFunction('nope')).toBeUndefined();
	});
});

describe('formatAddress', () => {
	it('formats to hex with 0x prefix', () => {
		expect(formatAddress(0x7ffc0060)).toBe('0x7ffc0060');
	});

	it('pads to 8 characters', () => {
		expect(formatAddress(0x100)).toBe('0x00000100');
	});

	it('formats zero', () => {
		expect(formatAddress(0)).toBe('0x00000000');
	});
});
