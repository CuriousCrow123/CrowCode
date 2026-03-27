import type { ASTNode, CType, CValue, InterpreterOptions, ChildSpec } from './types';
import { Memory, formatAddress } from './memory';
import { Evaluator } from './evaluator';
import {
	TypeRegistry,
	primitiveType,
	isStructType,
	isPointerType,
	isFunctionPointerType,
} from './types-c';
import { createStdlib, buildStructChildSpecs } from './stdlib';
import type { Program } from '$lib/api/types';
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
} from './handlers';

export type InterpretResult = {
	program: Program;
	errors: string[];
};

export function interpret(source: string, opts?: InterpreterOptions): InterpretResult {
	const interpreter = new Interpreter(source, opts);
	return interpreter.run();
}

export class Interpreter {
	private memory: Memory;
	private evaluator: Evaluator;
	private typeReg: TypeRegistry;
	private errors: string[] = [];
	private stepCount = 0;
	private frameDepth = 0;
	private maxSteps: number;
	private maxFrames: number;
	private source: string;

	private callDeclContext: { varName: string; colStart?: number; colEnd?: number } | null = null;

	private breakFlag = false;
	private continueFlag = false;
	private returnFlag = false;
	private returnValue: CValue | null = null;

	constructor(source: string, opts?: InterpreterOptions) {
		this.source = source;
		this.maxSteps = opts?.maxSteps ?? 500;
		this.maxFrames = opts?.maxFrames ?? 256;
		const maxHeap = opts?.maxHeapBytes ?? 1024 * 1024;

		this.memory = new Memory('Custom Program', source, maxHeap);
		this.typeReg = new TypeRegistry();

		const stdlibEnv = {
			malloc: (size: number, allocator: string, line: number) =>
				this.memory.mallocRuntime(size, allocator, line),
			free: (address: number) => this.memory.freeByAddress(address),
		};

		const stdlib = createStdlib(stdlibEnv, this.typeReg, {
			read: (addr) => this.memory.readMemory(addr),
			write: (addr, val) => this.memory.writeMemory(addr, val),
		});

		this.evaluator = new Evaluator(this.memory, this.typeReg, (name, args, line, colStart, colEnd) => {
			const fn = this.memory.getFunction(name);
			if (fn) {
				const savedContext = this.callDeclContext;
				this.callDeclContext = {
					varName: savedContext?.varName && this.frameDepth > 0 ? '' : savedContext?.varName ?? '',
					colStart,
					colEnd,
				};
				const result = this.callFunction(fn, args, line);
				this.callDeclContext = savedContext;
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
					return this.callFunction(target.node, args, line);
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

	// === HandlerContext factory ===

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
			get callDeclContext() { return self.callDeclContext; },
			set callDeclContext(v) { self.callDeclContext = v; },
			dispatch: (node, sharesStep) => self.executeStatement(node, sharesStep),
			dispatchStatements: (stmts, first) => self.executeStatements(stmts, first),
			callFunction: (fn, args, line) => self.callFunction(fn, args, line),
			formatValue: (type, data, init) => self.formatValue(type, data, init),
			describeExpr: (node) => self.describeExpr(node),
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
		this.executeMainFunction(mainFn);

		const result = this.memory.finish();
		return {
			program: result.program,
			errors: [...this.errors, ...result.errors],
		};
	}

	// === Main function entry ===

	private executeMainFunction(fn: ASTNode & { type: 'function_definition' }): void {
		const firstLine = this.findFirstStatementLine(fn.body);
		this.memory.beginStep({ line: firstLine }, 'Enter main()');
		this.memory.pushScopeRuntime('main');
		this.memory.emitScopeEntry('main', [], {
			caller: '_start',
			returnAddr: '0x00400580',
			file: '',
			line: fn.line,
		});

		if (fn.body.type === 'compound_statement') {
			this.executeStatements(fn.body.children, true);
		}

		this.detectLeaks();
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
			case 'declaration':
				executeDeclaration(ctx, node, sharesStep);
				break;
			case 'assignment':
				executeAssignment(ctx, node, sharesStep);
				break;
			case 'expression_statement':
				executeExpressionStatement(ctx, node, sharesStep);
				break;
			case 'return_statement':
				executeReturn(ctx, node, sharesStep);
				break;
			case 'if_statement':
				executeIf(ctx, node);
				break;
			case 'for_statement':
				executeFor(ctx, node);
				break;
			case 'while_statement':
				executeWhile(ctx, node);
				break;
			case 'do_while_statement':
				executeDoWhile(ctx, node);
				break;
			case 'switch_statement':
				executeSwitch(ctx, node);
				break;
			case 'compound_statement':
				executeBlock(ctx, node);
				break;
			case 'break_statement':
				if (!sharesStep) {
					this.memory.beginStep({ line: node.line }, 'break');
					this.stepCount++;
				}
				this.breakFlag = true;
				break;
			case 'continue_statement':
				if (!sharesStep) {
					this.memory.beginStep({ line: node.line }, 'continue');
					this.stepCount++;
				}
				this.continueFlag = true;
				break;
			case 'struct_definition':
			case 'function_definition':
			case 'preproc_include':
				break;
			default:
				this.errors.push(`Unhandled statement type: ${node.type}`);
		}
	}

	// === Function calls ===

	private callFunction(fn: ASTNode & { type: 'function_definition' }, args: CValue[], line: number): { value: CValue; error?: string } {
		if (this.frameDepth >= this.maxFrames) {
			return {
				value: { type: primitiveType('int'), data: 0, address: 0 },
				error: `Stack overflow: exceeded ${this.maxFrames} frames`,
			};
		}

		this.frameDepth++;
		const savedSP = this.memory.saveStackPointer();
		const callerName = this.memory.currentScopeName() ?? '_start';

		this.memory.pushScopeRuntime(fn.name);
		const declaredParams: CValue[] = [];
		for (let i = 0; i < fn.params.length; i++) {
			const paramType = this.typeReg.resolve(fn.params[i].typeSpec);
			const arg = args[i] ? Evaluator.decayArrayToPointer(args[i]) : undefined;
			const v = this.memory.declareVariableRuntime(fn.params[i].name, paramType, arg?.data ?? 0);
			declaredParams.push(v);
		}

		for (let i = 0; i < fn.params.length; i++) {
			const paramType = this.typeReg.resolve(fn.params[i].typeSpec);
			if (isPointerType(paramType) && args[i]?.data != null && args[i].data !== 0) {
				const blockId = this.memory.getHeapBlockIdByAddress(args[i].data!);
				if (blockId) {
					this.memory.setPointerTarget(fn.params[i].name, blockId);
				}
			}
		}

		const params = fn.params.map((p, i) => {
			const paramType = this.typeReg.resolve(p.typeSpec);
			const argVal = args[i]?.data ?? 0;
			let children: ChildSpec[] | undefined;

			if (isStructType(paramType)) {
				const srcAddr = args[i]?.address ?? 0;
				const initValues = new Map<string, string>();
				for (const field of paramType.fields) {
					const val = this.memory.readMemory(srcAddr + field.offset);
					if (val !== undefined) initValues.set(field.name, String(val));
				}
				children = buildStructChildSpecs(paramType, initValues);

				const destAddr = declaredParams[i].address;
				for (const field of paramType.fields) {
					const val = this.memory.readMemory(srcAddr + field.offset);
					if (val !== undefined) this.memory.writeMemory(destAddr + field.offset, val);
				}
			}

			return {
				name: p.name,
				type: paramType,
				value: isStructType(paramType) ? '' : String(argVal),
				address: declaredParams[i].address,
				children,
			};
		});

		const callColStart = this.callDeclContext?.colStart;
		const callColEnd = this.callDeclContext?.colEnd;
		this.memory.beginStep(
			{ line, colStart: callColStart, colEnd: callColEnd },
			`Call ${fn.name}(${params.map((p) => p.name).join(', ')}) — push stack frame`,
		);
		this.stepCount++;

		this.memory.emitScopeEntry(fn.name, params, {
			caller: `${callerName}()`,
			file: '',
			line: fn.line,
		});

		for (const param of params) {
			if (param.address !== undefined) {
				this.memory.emitVariableEntry(param.name, param.type, param.value, param.address, param.children);
			}
		}

		this.returnFlag = false;
		this.returnValue = null;

		if (fn.body.type === 'compound_statement') {
			this.executeStatements(fn.body.children);
		}

		const retVal = this.returnValue ?? { type: primitiveType('int'), data: 0, address: 0 };
		this.returnFlag = false;
		this.returnValue = null;

		const declVar = this.callDeclContext?.varName;
		const retDesc = declVar
			? `${fn.name}() returns ${retVal.data ?? 0}, assign to ${declVar}`
			: `${fn.name}() returns ${retVal.data ?? 0}`;
		this.memory.beginStep({ line }, retDesc);
		this.stepCount++;
		this.memory.emitScopeExit();

		this.memory.popScopeRuntime();
		this.memory.restoreStackPointer(savedSP);
		this.frameDepth--;

		return { value: retVal };
	}

	// === Leak detection ===

	private detectLeaks(): void {
		const blocks = this.memory.getAllHeapBlocks();
		for (const [addr, block] of blocks) {
			if (block.status === 'allocated') {
				const blockId = this.memory.getHeapBlockIdByAddress(addr);
				if (blockId) {
					this.memory.leakHeapById(blockId);
				}
			}
		}
	}

	// === Helpers (shared with handlers via ctx) ===

	private formatValue(type: CType, data: number | null, initialized = true): string {
		if (!initialized) return '(uninit)';
		if (data === null) return '0';
		if (isFunctionPointerType(type) && data !== 0) {
			const target = this.memory.getFunctionByIndex(data);
			if (target) return `→ ${target.name}`;
		}
		if (isPointerType(type)) {
			if (data === 0) return 'NULL';
			return formatAddress(data);
		}
		if (type.kind === 'primitive' && (type.name === 'float' || type.name === 'double')) {
			const s = parseFloat(data.toFixed(6)).toString();
			return s.includes('.') ? s : s + '.0';
		}
		return String(data);
	}

	private describeExpr(node: ASTNode): string {
		switch (node.type) {
			case 'identifier': return node.name;
			case 'number_literal': return String(node.value);
			case 'string_literal': return `"${node.value}"`;
			case 'null_literal': return 'NULL';
			case 'binary_expression':
				return `${this.describeExpr(node.left)} ${node.operator} ${this.describeExpr(node.right)}`;
			case 'unary_expression':
				if (node.prefix) return `${node.operator}${this.describeExpr(node.operand)}`;
				return `${this.describeExpr(node.operand)}${node.operator}`;
			case 'call_expression':
				return `${node.callee}(${node.args.map((a) => this.describeExpr(a)).join(', ')})`;
			case 'member_expression':
				return `${this.describeExpr(node.object)}${node.arrow ? '->' : '.'}${node.field}`;
			case 'subscript_expression':
				return `${this.describeExpr(node.object)}[${this.describeExpr(node.index)}]`;
			case 'sizeof_expression':
				return `sizeof(${node.targetType.structName ?? node.targetType.base})`;
			default:
				return '...';
		}
	}

	private findFirstStatementLine(body: ASTNode): number {
		if (body.type === 'compound_statement' && body.children.length > 0) {
			return this.getLine(body.children[0]);
		}
		return this.getLine(body);
	}

	private getLine(node: ASTNode): number {
		if ('line' in node) return node.line as number;
		return 1;
	}
}
