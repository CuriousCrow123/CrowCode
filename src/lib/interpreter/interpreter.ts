import type { ASTNode, CType, CValue, InterpreterOptions } from './types';
import { Memory, formatAddress } from './memory';
import { Evaluator } from './evaluator';
import {
	TypeRegistry,
	primitiveType,
	isFunctionPointerType,
} from './types-c';
import { createStdlib } from './stdlib';
import { IoState } from './io-state';
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
	private io: IoState;
	private errors: string[] = [];
	private stepCount = 0;
	private frameDepth = 0;
	private maxSteps: number;
	private maxFrames: number;
	private interactive: boolean;

	private callContext: { varName: string; colStart?: number; colEnd?: number } | null = null;
	private breakFlag = false;
	private continueFlag = false;
	private returnFlag = false;
	private returnValue: CValue | null = null;
	private needsInput = false;

	constructor(source: string, opts?: InterpreterOptions) {
		this.maxSteps = opts?.maxSteps ?? 500;
		this.maxFrames = opts?.maxFrames ?? 256;
		this.interactive = opts?.interactive ?? false;
		const maxHeap = opts?.maxHeapBytes ?? 1024 * 1024;

		this.memory = new Memory('Custom Program', source, maxHeap);
		this.typeReg = new TypeRegistry();
		this.io = new IoState(opts?.stdin ?? '');
		this.memory.setIoEventsFlusher(
			() => {
				const events = this.io.flushEvents();
				// Add/update stdin buffer entry in memory view when reads occur
				if (events) {
					const hasReads = events.some((e) => e.kind === 'read');
					if (hasReads) {
						this.memory.addStdinEntry(this.io.getStdinFull());
						this.memory.updateStdinCursor(this.io.getStdinPos(), this.io.getStdinFull());
					}
				}
				return events;
			},
			() => this.io.peekEvents(),
		);

		const memAccess = {
			read: (addr: number) => this.memory.readMemory(addr),
			write: (addr: number, val: number) => this.memory.writeMemory(addr, val),
		};

		const stdlib = createStdlib(
			{
				malloc: (size, allocator, line) => this.memory.mallocRuntime(size, allocator, line),
				free: (address) => this.memory.freeByAddress(address),
			},
			memAccess,
			this.io,
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
				// Drive callFunction generator synchronously.
				// If it yields (needsInput set inside called function), we stop and return default.
				const result = driveGenerator(callFunction(this.ctx(), fn, args, line));
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
					return driveGenerator(callFunction(this.ctx(), target.node, args, line));
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
			get io() { return self.io; },
			get errors() { return self.errors; },
			get maxSteps() { return self.maxSteps; },
			get maxFrames() { return self.maxFrames; },
			get interactive() { return self.interactive; },
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
			get needsInput() { return self.needsInput; },
			set needsInput(v) { self.needsInput = v; },
			dispatch: (node, sharesStep) => self.executeStatement(node, sharesStep),
			dispatchStatements: (stmts, first) => self.executeStatements(stmts, first),
			callFunction: (fn, args, line) => callFunction(self.ctx(), fn, args, line) as Generator<void, { value: CValue; error?: string }, void>,
			formatValue: (type, data, init) => formatValue(self.memory, type, data, init),
			describeExpr,
		};
	}

	// === Public API ===

	run(): InterpretResult {
		return this.memory.finish() as InterpretResult;
	}

	/** Synchronous interpretation — runs to completion without interactive pausing. */
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
			// Drive the generator synchronously — needsInput just causes early break (EOF behavior)
			const gen = this.executeStatements(mainFn.body.children, true);
			while (!gen.next().done) { /* drain */ }
			this.needsInput = false; // Clear — in sync mode, needsInput is treated as EOF
		}

		detectLeaks(this.memory);

		const result = this.memory.finish();
		return {
			program: result.program,
			errors: [...this.errors, ...result.errors],
		};
	}

	/** Generator-based interpretation — yields when stdin is exhausted and input is needed. */
	*interpretGen(ast: ASTNode & { type: 'translation_unit' }): Generator<
		{ type: 'need_input'; program: Program },
		InterpretResult,
		string
	> {
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
			// Use the yielding version of executeStatements
			yield* this.executeStatementsYielding(mainFn.body.children, true);
		}

		detectLeaks(this.memory);

		const result = this.memory.finish();
		return {
			program: result.program,
			errors: [...this.errors, ...result.errors],
		};
	}

	// === Statement dispatch (generators) ===

	/**
	 * Execute statements, yielding NeedInput when stdin is exhausted.
	 * This is the top-level yielding wrapper — it checks needsInput after each statement
	 * and yields the partial program up to the caller (interpretGen).
	 */
	private *executeStatementsYielding(
		statements: ASTNode[],
		firstSharesStep = false,
	): Generator<{ type: 'need_input'; program: Program }, void, string> {
		for (let i = 0; i < statements.length; i++) {
			if (this.breakFlag || this.continueFlag || this.returnFlag) break;
			if (this.stepCount >= this.maxSteps) {
				this.errors.push(`Step limit exceeded (${this.maxSteps})`);
				break;
			}
			yield* this.executeStatement(statements[i], firstSharesStep && i === 0);

			// After each statement, check if input is needed
			while (this.needsInput) {
				const partialProgram: Program = {
					name: this.memory.programName,
					source: this.memory.programSource,
					steps: this.memory.getSteps(),
				};
				const input: string = yield { type: 'need_input', program: partialProgram };
				this.io.appendStdin(input);
				this.needsInput = false;
				// Re-execute the same statement that needed input
				yield* this.executeStatement(statements[i], firstSharesStep && i === 0);
			}
		}
	}

	private *executeStatements(statements: ASTNode[], firstSharesStep = false): Generator<void, void, void> {
		for (let i = 0; i < statements.length; i++) {
			if (this.breakFlag || this.continueFlag || this.returnFlag || this.needsInput) break;
			if (this.stepCount >= this.maxSteps) {
				this.errors.push(`Step limit exceeded (${this.maxSteps})`);
				break;
			}
			yield* this.executeStatement(statements[i], firstSharesStep && i === 0);
		}
	}

	private *executeStatement(node: ASTNode, sharesStep = false): Generator<void, void, void> {
		const ctx = this.ctx();
		switch (node.type) {
			case 'declaration': executeDeclaration(ctx, node, sharesStep); break;
			case 'assignment': executeAssignment(ctx, node, sharesStep); break;
			case 'expression_statement': yield* executeExpressionStatement(ctx, node, sharesStep); break;
			case 'return_statement': executeReturn(ctx, node, sharesStep); break;
			case 'if_statement': yield* executeIf(ctx, node); break;
			case 'for_statement': yield* executeFor(ctx, node); break;
			case 'while_statement': yield* executeWhile(ctx, node); break;
			case 'do_while_statement': yield* executeDoWhile(ctx, node); break;
			case 'switch_statement': yield* executeSwitch(ctx, node); break;
			case 'compound_statement': yield* executeBlock(ctx, node); break;
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

/** Drive a generator to completion synchronously, returning its final value.
 * If the generator yields (needsInput was set), we stop and return a default value. */
function driveGenerator<T>(gen: Generator<void, T, void>): T {
	let result = gen.next();
	while (!result.done) {
		// Generator yielded — something set needsInput deep inside.
		// We can't provide input here (evaluator callback is sync), so just keep driving.
		result = gen.next();
	}
	return result.value;
}
