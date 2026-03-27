import type { ASTNode, CType, CValue, InterpreterOptions } from './types';
import { Memory, formatAddress } from './memory';
import { Evaluator } from './evaluator';
import {
	TypeRegistry,
	primitiveType,
	isFunctionPointerType,
} from './types-c';
import { createStdlib } from './stdlib';
import type { Program } from '$lib/types';
import type { HandlerContext } from './handlers/types';
import {
	executeDeclaration,
	executeAssignment,
	executeExpressionStatement,
	executeReturn,
	executeIf,
	executeFor,
	executeWhile,
	executeDoWhile,
	executeSwitch,
	executeBlock,
	callFunction,
	detectLeaks,
	formatValue,
	describeExpr,
} from './handlers';

type InterpretResult = {
	program: Program;
	errors: string[];
};

export class Interpreter {
	private memory: Memory;
	private evaluator: Evaluator;
	private typeReg: TypeRegistry;
	private errors: string[] = [];
	private stepCount = 0;
	private frameDepth = 0;
	private maxSteps: number;
	private maxFrames: number;

	private callContext: { varName: string; colStart?: number; colEnd?: number } | null = null;
	private breakFlag = false;
	private continueFlag = false;
	private returnFlag = false;
	private returnValue: CValue | null = null;

	constructor(source: string, opts?: InterpreterOptions) {
		this.maxSteps = opts?.maxSteps ?? 500;
		this.maxFrames = opts?.maxFrames ?? 256;
		const maxHeap = opts?.maxHeapBytes ?? 1024 * 1024;

		this.memory = new Memory('Custom Program', source, maxHeap);
		this.typeReg = new TypeRegistry();

		const stdlib = createStdlib(
			{
				malloc: (size, allocator, line) => this.memory.mallocRuntime(size, allocator, line),
				free: (address) => this.memory.freeByAddress(address),
			},
			{
				read: (addr) => this.memory.readMemory(addr),
				write: (addr, val) => this.memory.writeMemory(addr, val),
			},
		);

		this.evaluator = new Evaluator(this.memory, this.typeReg, (name, args, line, colStart, colEnd) => {
			const fn = this.memory.getFunction(name);
			if (fn) {
				const savedCtx = this.callContext;
				this.callContext = {
					varName: savedCtx?.varName && this.frameDepth > 0 ? '' : savedCtx?.varName ?? '',
					colStart,
					colEnd,
				};
				const result = callFunction(this.ctx(), fn, args, line);
				this.callContext = savedCtx;
				return result;
			}

			const fpVar = this.memory.lookupVariable(name);
			if (fpVar && isFunctionPointerType(fpVar.type)) {
				const idx = fpVar.data ?? 0;
				if (idx === 0) {
					return { value: { type: primitiveType('int'), data: 0, address: 0 }, error: `Null function pointer call at line ${line}` };
				}
				const target = this.memory.getFunctionByIndex(idx);
				if (target) {
					return callFunction(this.ctx(), target.node, args, line);
				}
				return { value: { type: primitiveType('int'), data: 0, address: 0 }, error: `Invalid function pointer at line ${line}` };
			}

			return stdlib(name, args, line);
		});

		this.evaluator.setMemoryReader((address) => {
			if (this.memory.isFreedAddress(address)) {
				this.errors.push(`Use-after-free: reading from freed memory at ${formatAddress(address)}`);
				return undefined;
			}
			return this.memory.readMemory(address);
		});
	}

	// === HandlerContext ===

	private ctx(): HandlerContext {
		const self = this;
		return {
			get memory() { return self.memory; },
			get evaluator() { return self.evaluator; },
			get typeReg() { return self.typeReg; },
			get errors() { return self.errors; },
			get maxSteps() { return self.maxSteps; },
			get maxFrames() { return self.maxFrames; },
			get stepCount() { return self.stepCount; },
			set stepCount(v) { self.stepCount = v; },
			get frameDepth() { return self.frameDepth; },
			set frameDepth(v) { self.frameDepth = v; },
			get breakFlag() { return self.breakFlag; },
			set breakFlag(v) { self.breakFlag = v; },
			get continueFlag() { return self.continueFlag; },
			set continueFlag(v) { self.continueFlag = v; },
			get returnFlag() { return self.returnFlag; },
			set returnFlag(v) { self.returnFlag = v; },
			get returnValue() { return self.returnValue; },
			set returnValue(v) { self.returnValue = v; },
			get callContext() { return self.callContext; },
			set callContext(v) { self.callContext = v; },
			dispatch: (node, sharesStep) => self.executeStatement(node, sharesStep),
			dispatchStatements: (stmts, first) => self.executeStatements(stmts, first),
			callFunction: (fn, args, line) => callFunction(self.ctx(), fn, args, line),
			formatValue: (type, data, init) => formatValue(self.memory, type, data, init),
			describeExpr,
		};
	}

	// === Public API ===

	run(): InterpretResult {
		return this.memory.finish() as InterpretResult;
	}

	interpretAST(ast: ASTNode & { type: 'translation_unit' }): InterpretResult {
		for (const node of ast.children) {
			if (node.type === 'struct_definition') {
				this.typeReg.defineStruct(node.name, node.fields);
			} else if (node.type === 'function_definition' && node.name !== 'main') {
				this.memory.defineFunction(node.name, node);
			}
		}

		const mainFn = ast.children.find(
			(n) => n.type === 'function_definition' && n.name === 'main'
		);

		if (!mainFn || mainFn.type !== 'function_definition') {
			this.errors.push('No main() function found');
			return { ...this.memory.finish(), errors: this.errors };
		}

		this.memory.defineFunction('main', mainFn);

		const firstLine = this.findFirstStatementLine(mainFn.body);
		this.memory.beginStep({ line: firstLine }, 'Enter main()');
		this.memory.pushScopeRuntime('main');
		this.memory.emitScopeEntry('main', [], {
			caller: '_start',
			returnAddr: '0x00400580',
			file: '',
			line: mainFn.line,
		});

		if (mainFn.body.type === 'compound_statement') {
			this.executeStatements(mainFn.body.children, true);
		}

		detectLeaks(this.memory);

		const result = this.memory.finish();
		return {
			program: result.program,
			errors: [...this.errors, ...result.errors],
		};
	}

	// === Statement dispatch ===

	private executeStatements(statements: ASTNode[], firstSharesStep = false): void {
		for (let i = 0; i < statements.length; i++) {
			if (this.breakFlag || this.continueFlag || this.returnFlag) break;
			if (this.stepCount >= this.maxSteps) {
				this.errors.push(`Step limit exceeded (${this.maxSteps})`);
				break;
			}
			this.executeStatement(statements[i], firstSharesStep && i === 0);
		}
	}

	private executeStatement(node: ASTNode, sharesStep = false): void {
		const ctx = this.ctx();
		switch (node.type) {
			case 'declaration': executeDeclaration(ctx, node, sharesStep); break;
			case 'assignment': executeAssignment(ctx, node, sharesStep); break;
			case 'expression_statement': executeExpressionStatement(ctx, node, sharesStep); break;
			case 'return_statement': executeReturn(ctx, node, sharesStep); break;
			case 'if_statement': executeIf(ctx, node); break;
			case 'for_statement': executeFor(ctx, node); break;
			case 'while_statement': executeWhile(ctx, node); break;
			case 'do_while_statement': executeDoWhile(ctx, node); break;
			case 'switch_statement': executeSwitch(ctx, node); break;
			case 'compound_statement': executeBlock(ctx, node); break;
			case 'break_statement':
				if (!sharesStep) { this.memory.beginStep({ line: node.line }, 'break'); this.stepCount++; }
				this.breakFlag = true;
				break;
			case 'continue_statement':
				if (!sharesStep) { this.memory.beginStep({ line: node.line }, 'continue'); this.stepCount++; }
				this.continueFlag = true;
				break;
			case 'struct_definition': case 'function_definition': case 'preproc_include': break;
			default: this.errors.push(`Unhandled statement type: ${node.type}`);
		}
	}

	// === Helpers ===

	private findFirstStatementLine(body: ASTNode): number {
		if (body.type === 'compound_statement' && body.children.length > 0) {
			if ('line' in body.children[0]) return body.children[0].line as number;
		}
		if ('line' in body) return body.line as number;
		return 1;
	}
}
