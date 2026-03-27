import type { ASTNode, CType, CValue, InterpreterOptions, ChildSpec } from './types';
import type { SourceLocation } from '$lib/api/types';
import { Memory, formatAddress } from './memory';
import { Evaluator } from './evaluator';
import {
	TypeRegistry,
	primitiveType,
	pointerType,
	arrayType,
	sizeOf,
	typeToString,
	isStructType,
	isArrayType,
	isPointerType,
	isFunctionPointerType,
} from './types-c';
import { createStdlib, buildStructChildSpecs, buildArrayChildSpecs } from './stdlib';
import type { Program } from '$lib/api/types';

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

	// Context for function calls initiated from declarations (e.g., int d = distance(...))
	private callDeclContext: { varName: string; colStart?: number; colEnd?: number } | null = null;

	// Control flow signals
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

		// Stdlib adapter: bridges Memory's API to the StdlibEnv interface
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
			// Check user-defined functions first
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

			// Check function pointer variables
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

			// Then stdlib
			return stdlib(name, args, line);
		});

		// Wire up memory reader so evaluator can read heap/array values
		// Check for use-after-free on every read
		this.evaluator.setMemoryReader((address) => {
			if (this.memory.isFreedAddress(address)) {
				this.errors.push(`Use-after-free: reading from freed memory at ${formatAddress(address)}`);
				return undefined;
			}
			return this.memory.readMemory(address);
		});
	}

	run(): InterpretResult {
		return this.memory.finish() as InterpretResult;
	}

	interpretAST(ast: ASTNode & { type: 'translation_unit' }): InterpretResult {
		// First pass: register struct definitions and function definitions
		for (const node of ast.children) {
			if (node.type === 'struct_definition') {
				this.typeReg.defineStruct(node.name, node.fields);
			} else if (node.type === 'function_definition' && node.name !== 'main') {
				this.memory.defineFunction(node.name, node);
			}
		}

		// Find and execute main
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

	private executeMainFunction(fn: ASTNode & { type: 'function_definition' }): void {
		const firstLine = this.findFirstStatementLine(fn.body);
		this.memory.beginStep(
			{ line: firstLine },
			`Enter main()`,
		);
		this.memory.pushScopeRuntime('main');
		this.memory.emitScopeEntry('main', [], {
			caller: '_start',
			returnAddr: '0x00400580',
			file: '',
			line: fn.line,
		});

		// Execute body statements — first statement shares the enter step
		if (fn.body.type === 'compound_statement') {
			this.executeStatements(fn.body.children, true);
		}

		// Leak detection
		this.detectLeaks();
	}

	// === Statement execution ===

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
		switch (node.type) {
			case 'declaration':
				this.executeDeclaration(node, sharesStep);
				break;
			case 'assignment':
				this.executeAssignment(node, sharesStep);
				break;
			case 'expression_statement':
				this.executeExpressionStatement(node, sharesStep);
				break;
			case 'return_statement':
				this.executeReturn(node, sharesStep);
				break;
			case 'if_statement':
				this.executeIf(node);
				break;
			case 'for_statement':
				this.executeFor(node);
				break;
			case 'while_statement':
				this.executeWhile(node);
				break;
			case 'do_while_statement':
				this.executeDoWhile(node);
				break;
			case 'switch_statement':
				this.executeSwitch(node);
				break;
			case 'compound_statement':
				this.executeBlock(node);
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

	// === Declarations ===

	private executeDeclaration(node: ASTNode & { type: 'declaration' }, sharesStep: boolean): void {
		const type = this.typeReg.resolve(node.declType);
		let value: CValue;
		let displayValue: string;
		let children: ChildSpec[] | undefined;

		if (isStructType(type)) {
			value = this.memory.declareVariableRuntime(node.name, type);
			displayValue = '';
			children = buildStructChildSpecs(type);

			if (node.initializer?.type === 'init_list') {
				this.initStructFromList(type, children, node.initializer.values, value.address);
			}
		} else if (isArrayType(type)) {
			value = this.memory.declareVariableRuntime(node.name, type);
			displayValue = '';

			let initValues: string[] | undefined;
			if (node.initializer?.type === 'init_list') {
				const flatValues: { val: number }[] = [];
				const flattenInitList = (list: ASTNode[]) => {
					for (const v of list) {
						if (v.type === 'init_list') {
							flattenInitList(v.values);
						} else {
							const result = this.evaluator.eval(v);
							if (result.error) this.errors.push(result.error);
							flatValues.push({ val: result.value.data ?? 0 });
						}
					}
				};
				flattenInitList(node.initializer.values);

				let leafType = type.elementType;
				while (isArrayType(leafType)) leafType = leafType.elementType;
				const leafSize = sizeOf(leafType);

				initValues = flatValues.map((fv, i) => {
					this.memory.writeMemory(value.address + i * leafSize, fv.val);
					return String(fv.val);
				});
			}

			children = buildArrayChildSpecs(type.elementType, type.size, initValues);
		} else {
			// Scalar declaration
			let initData: number | null = node.initializer ? 0 : null;
			let initWasFunctionCall = false;
			if (node.initializer) {
				if (isFunctionPointerType(type) && node.initializer.type === 'identifier') {
					const fnName = node.initializer.name;
					const fnIdx = this.memory.getFunctionIndex(fnName);
					if (fnIdx > 0) {
						initData = fnIdx;
					}
				}
				else if (node.initializer.type === 'string_literal' && isPointerType(type)) {
					this.executeStringLiteralDecl(node, node.initializer, type, sharesStep);
					return;
				}
				else if (node.initializer.type === 'call_expression') {
					const callResult = this.evaluateCallForDecl(node, type);
					if (callResult.handled) return;
					if (callResult.value !== undefined) {
						initData = callResult.value;
						initWasFunctionCall = !!callResult.isUserFunc;
					}
				} else {
					const result = this.evaluator.eval(node.initializer);
					if (result.error) this.errors.push(result.error);
					const decayed = isPointerType(type)
						? Evaluator.decayArrayToPointer(result.value)
						: result.value;
					initData = decayed.data;
					if (initData === null || initData === undefined) initData = 0;
				}
			}
			value = this.memory.declareVariableRuntime(node.name, type, initData);
			displayValue = this.formatValue(type, initData, initData !== null);

			if (initWasFunctionCall) {
				sharesStep = true;
			}
		}

		if (!sharesStep) {
			this.memory.beginStep(
				{ line: node.line },
				this.formatDeclDescription(node.name, type, displayValue!),
			);
			this.stepCount++;
		}

		if (children) {
			this.memory.emitVariableEntry(node.name, type, displayValue!, value!.address, children);
		} else {
			this.memory.emitVariableEntry(node.name, type, displayValue!, value!.address);
		}
	}

	private evaluateCallForDecl(
		node: ASTNode & { type: 'declaration' },
		declType: CType,
	): { handled: boolean; value?: number | null; isUserFunc?: boolean } {
		if (node.initializer?.type !== 'call_expression') return { handled: false };
		const call = node.initializer;

		if (call.callee === 'malloc' || call.callee === 'calloc') {
			const handled = this.executeMallocDecl(node, call, declType);
			return { handled };
		}

		const isUserFunc = !!this.memory.getFunction(call.callee);
		this.callDeclContext = { varName: node.name };
		const result = this.evaluator.eval(call);
		this.callDeclContext = null;
		if (result.error) this.errors.push(result.error);
		return { handled: false, value: result.value.data, isUserFunc };
	}

	private executeMallocDecl(
		decl: ASTNode & { type: 'declaration' },
		call: ASTNode & { type: 'call_expression' },
		declType: CType,
	): boolean {
		const args = call.args.map((a) => {
			const r = this.evaluator.eval(a);
			if (r.error) this.errors.push(r.error);
			return r.value;
		});

		let totalSize: number;
		let allocator: string;
		let heapType: CType;

		if (call.callee === 'calloc') {
			const count = args[0]?.data ?? 0;
			const elemSize = args[1]?.data ?? 0;
			totalSize = count * elemSize;
			allocator = 'calloc';
			if (isPointerType(declType)) {
				heapType = arrayType(declType.pointsTo, count);
			} else {
				heapType = primitiveType('void');
			}
		} else {
			totalSize = args[0]?.data ?? 0;
			allocator = 'malloc';
			if (isPointerType(declType)) {
				const elemType = declType.pointsTo;
				const elemSize = sizeOf(elemType);
				const count = elemSize > 0 ? totalSize / elemSize : 0;
				if (elemSize > 0 && count > 1 && count <= 32 && totalSize % elemSize === 0) {
					heapType = arrayType(elemType, count);
				} else {
					heapType = elemType;
				}
			} else {
				heapType = primitiveType('void');
			}
		}

		const { address, error } = this.memory.mallocRuntime(totalSize, allocator, decl.line);
		if (error) {
			this.errors.push(error);
			return true;
		}

		this.memory.setHeapBlockType(address, heapType);

		const ptrValue = this.memory.declareVariableRuntime(decl.name, declType, address);

		let heapChildren: ChildSpec[] | undefined;
		if (isStructType(heapType)) {
			heapChildren = buildStructChildSpecs(heapType);
		} else if (isArrayType(heapType)) {
			heapChildren = buildArrayChildSpecs(heapType.elementType, heapType.size);
		}

		const sizeDesc = `${totalSize}`;
		const desc = `${allocator}(${this.formatMallocArgs(call)}) — allocate ${sizeDesc} bytes`;

		this.memory.beginStep({ line: decl.line }, desc);
		this.stepCount++;

		this.memory.emitHeapEntry(
			decl.name,
			heapType,
			totalSize,
			allocator,
			decl.line,
			address,
			heapChildren,
		);

		this.memory.emitVariableEntry(
			decl.name,
			declType,
			formatAddress(address),
			ptrValue.address,
		);

		return true;
	}

	private executeStringLiteralDecl(
		decl: ASTNode & { type: 'declaration' },
		literal: ASTNode & { type: 'string_literal' },
		declType: CType,
		sharesStep: boolean,
	): void {
		const str = literal.value;
		const size = str.length + 1;

		const { address, error } = this.memory.mallocRuntime(size, 'string_literal', decl.line);
		if (error) {
			this.errors.push(error);
			return;
		}

		const heapType = arrayType(primitiveType('char'), size);
		this.memory.setHeapBlockType(address, heapType);

		for (let i = 0; i < str.length; i++) {
			this.memory.writeMemory(address + i, str.charCodeAt(i));
		}
		this.memory.writeMemory(address + str.length, 0);

		const ptrValue = this.memory.declareVariableRuntime(decl.name, declType, address);

		const charValues = str.split('').map((c) => {
			const code = c.charCodeAt(0);
			return code >= 32 && code <= 126 ? `'${c}'` : String(code);
		});
		charValues.push(`'\\0'`);
		const heapChildren = buildArrayChildSpecs(primitiveType('char'), size, charValues);

		if (!sharesStep) {
			this.memory.beginStep({ line: decl.line }, `char *${decl.name} = "${str}"`);
			this.stepCount++;
		}

		this.memory.emitHeapEntry(
			decl.name,
			heapType,
			size,
			'string_literal',
			decl.line,
			address,
			heapChildren,
		);

		this.memory.emitVariableEntry(
			decl.name,
			declType,
			formatAddress(address),
			ptrValue.address,
		);
	}

	private executeMallocAssign(
		node: ASTNode & { type: 'assignment' },
		call: ASTNode & { type: 'call_expression' },
		sharesStep: boolean,
	): void {
		const args = call.args.map((a) => {
			const r = this.evaluator.eval(a);
			if (r.error) this.errors.push(r.error);
			return r.value;
		});

		let targetType: CType | undefined;
		if (node.target.type === 'identifier') {
			const existing = this.memory.lookupVariable(node.target.name);
			if (!existing) {
				this.errors.push(`Undefined variable '${node.target.name}' at line ${node.line}`);
				return;
			}
			targetType = existing.type;
		} else if (node.target.type === 'member_expression') {
			const targetEval = this.evaluator.eval(node.target);
			if (targetEval.error) { this.errors.push(targetEval.error); return; }
			targetType = targetEval.value.type;
		}

		let totalSize: number;
		let allocator: string;
		let heapType: CType;

		if (call.callee === 'calloc') {
			const count = args[0]?.data ?? 0;
			const elemSize = args[1]?.data ?? 0;
			totalSize = count * elemSize;
			allocator = 'calloc';
			if (targetType && isPointerType(targetType)) {
				heapType = arrayType(targetType.pointsTo, count);
			} else {
				heapType = primitiveType('void');
			}
		} else {
			totalSize = args[0]?.data ?? 0;
			allocator = 'malloc';
			if (targetType && isPointerType(targetType)) {
				const elemType = targetType.pointsTo;
				const elemSize = sizeOf(elemType);
				const count = elemSize > 0 ? totalSize / elemSize : 0;
				if (elemSize > 0 && count > 1 && count <= 32 && totalSize % elemSize === 0) {
					heapType = arrayType(elemType, count);
				} else {
					heapType = elemType;
				}
			} else {
				heapType = primitiveType('void');
			}
		}

		const { address, error } = this.memory.mallocRuntime(totalSize, allocator, node.line);
		if (error) {
			this.errors.push(error);
			return;
		}

		this.memory.setHeapBlockType(address, heapType);

		let heapChildren: ChildSpec[] | undefined;
		if (isStructType(heapType)) {
			heapChildren = buildStructChildSpecs(heapType);
		} else if (isArrayType(heapType)) {
			heapChildren = buildArrayChildSpecs(heapType.elementType, heapType.size);
		}

		if (!sharesStep) {
			const desc = `${allocator}(${this.formatMallocArgs(call)}) — allocate ${totalSize} bytes`;
			this.memory.beginStep({ line: node.line }, desc);
			this.stepCount++;
		}

		if (node.target.type === 'identifier') {
			const varName = node.target.name;
			this.memory.setVariable(varName, address);
			this.memory.emitHeapEntry(
				varName, heapType, totalSize, allocator,
				node.line, address, heapChildren,
			);
			this.memory.assignVariable(varName, formatAddress(address));
		} else if (node.target.type === 'member_expression') {
			const path = Evaluator.buildAccessPath(node.target);
			const fieldName = path[path.length - 1];

			const targetEval = this.evaluator.eval(node.target);
			if (targetEval.value.address) {
				this.memory.writeMemory(targetEval.value.address, address);
			}

			this.memory.emitHeapEntry(
				fieldName, heapType, totalSize, allocator,
				node.line, address, heapChildren,
			);

			const entryId = this.memory.resolvePointerPath(path);
			if (entryId) {
				this.memory.assignField(path, formatAddress(address));
			}
		}
	}

	// === Assignments ===

	private executeAssignment(node: ASTNode & { type: 'assignment' }, sharesStep: boolean): void {
		// Intercept malloc/calloc in assignment RHS
		if (node.operator === '=' && node.value?.type === 'call_expression') {
			const call = node.value;
			if ((call.callee === 'malloc' || call.callee === 'calloc') &&
				(node.target?.type === 'identifier' || node.target?.type === 'member_expression')) {
				this.executeMallocAssign(node, call, sharesStep);
				return;
			}
		}

		// Chained assignment
		if (node.operator === '=' && node.value?.type === 'assignment') {
			if (!sharesStep) {
				this.memory.beginStep({ line: node.line }, this.formatAssignDesc(node));
				this.stepCount++;
				sharesStep = true;
			}
			this.executeAssignment(node.value, true);
		}

		// Function pointer assignment
		if (node.operator === '=' && node.value?.type === 'identifier' && node.target?.type === 'identifier') {
			const targetVar = this.memory.lookupVariable(node.target.name);
			if (targetVar && isFunctionPointerType(targetVar.type)) {
				const fnIdx = this.memory.getFunctionIndex(node.value.name);
				if (fnIdx > 0) {
					if (!sharesStep) {
						this.memory.beginStep({ line: node.line }, this.formatAssignDesc(node));
						this.stepCount++;
					}
					this.memory.setVariable(node.target.name, fnIdx);
					const target = this.memory.getFunctionByIndex(fnIdx);
					this.memory.assignVariable(node.target.name, target ? `→ ${target.name}` : String(fnIdx));
					return;
				}
			}
		}

		const rhs = this.evaluator.eval(node.value);
		if (rhs.error) {
			this.errors.push(rhs.error);
			return;
		}

		if (!sharesStep) {
			this.memory.beginStep({ line: node.line }, this.formatAssignDesc(node));
			this.stepCount++;
		}

		if (node.target.type === 'identifier') {
			const existing = this.memory.lookupVariable(node.target.name);
			if (!existing) {
				this.errors.push(`Undefined variable '${node.target.name}' at line ${node.line}`);
				return;
			}

			let newVal = rhs.value.data ?? 0;
			const oldVal = existing.data ?? 0;
			newVal = this.applyCompoundOp(node.operator, oldVal, newVal);
			this.memory.setVariable(node.target.name, newVal);

			const displayVal = this.formatValue(existing.type, newVal);
			this.memory.assignVariable(node.target.name, displayVal);
		} else if (node.target.type === 'member_expression') {
			const path = Evaluator.buildAccessPath(node.target);
			let newVal = rhs.value.data ?? 0;

			if (node.operator !== '=') {
				const targetEval = this.evaluator.eval(node.target);
				const oldVal = targetEval.value.data ?? this.memory.readMemory(targetEval.value.address) ?? 0;
				newVal = this.applyCompoundOp(node.operator, oldVal, newVal);
			}

			const displayVal = String(newVal);

			const targetEval = this.evaluator.eval(node.target);
			if (targetEval.value.address) {
				this.memory.writeMemory(targetEval.value.address, newVal);
			}

			const entryId = this.memory.resolvePointerPath(path);
			if (entryId) {
				this.memory.directSetValue(entryId, displayVal);
			}
		} else if (node.target.type === 'unary_expression' && node.target.operator === '*') {
			const ptrResult = this.evaluator.eval(node.target.operand);
			if (ptrResult.error) { this.errors.push(ptrResult.error); return; }
			const addr = ptrResult.value.data ?? 0;
			if (addr === 0) { this.errors.push(`Null pointer dereference at line ${node.line}`); return; }
			if (this.memory.isFreedAddress(addr)) { this.errors.push(`Use-after-free: writing to freed memory at ${formatAddress(addr)}`); return; }
			const newVal = rhs.value.data ?? 0;
			this.memory.writeMemory(addr, newVal);
			const ptrName = node.target.operand.type === 'identifier' ? node.target.operand.name : undefined;
			if (ptrName) {
				const heapBlockId = this.memory.getHeapBlockId(ptrName);
				if (heapBlockId) {
					this.memory.directSetValue(heapBlockId, String(newVal));
				}
			}
		} else if (node.target.type === 'subscript_expression') {
			// Nested subscript: m[i][j] = val (2D array)
			if (node.target.object.type === 'subscript_expression') {
				const innerSub = node.target;
				const outerSub = innerSub.object as ASTNode & { type: 'subscript_expression' };

				const outerIdxResult = this.evaluator.eval(outerSub.index);
				const innerIdxResult = this.evaluator.eval(innerSub.index);
				if (outerIdxResult.error || innerIdxResult.error) {
					this.errors.push(outerIdxResult.error ?? innerIdxResult.error ?? 'Index error');
					return;
				}

				const outerIdx = outerIdxResult.value.data ?? 0;
				const innerIdx = innerIdxResult.value.data ?? 0;

				const rootName = outerSub.object.type === 'identifier' ? outerSub.object.name : '';
				const rootVar = rootName ? this.memory.lookupVariable(rootName) : undefined;

				let innerDim = 1;
				if (rootVar && isArrayType(rootVar.type) && isArrayType(rootVar.type.elementType)) {
					const outerSize = rootVar.type.size;
					innerDim = rootVar.type.elementType.size;

					if (outerIdx < 0 || outerIdx >= outerSize) {
						this.errors.push(`Array index ${outerIdx} out of bounds (size ${outerSize}) at line ${node.line}`);
						return;
					}
					if (innerIdx < 0 || innerIdx >= innerDim) {
						this.errors.push(`Array index ${innerIdx} out of bounds (size ${innerDim}) at line ${node.line}`);
						return;
					}
				}

				const flatIdx = outerIdx * innerDim + innerIdx;
				const newVal = rhs.value.data ?? 0;
				const displayVal = String(newVal);

				const targetEval = this.evaluator.eval(node.target);
				if (targetEval.value.address) {
					this.memory.writeMemory(targetEval.value.address, newVal);
				}

				const rootId = this.memory.resolvePathId([rootName]);
				if (rootId) {
					this.memory.directSetValue(`${rootId}-${flatIdx}`, displayVal);
				}
				return;
			}

			// Single subscript: arr[i] = val
			const objPath = Evaluator.buildAccessPath(node.target.object);
			const idxResult = this.evaluator.eval(node.target.index);
			if (idxResult.error) {
				this.errors.push(idxResult.error);
				return;
			}
			const index = idxResult.value.data ?? 0;

			const objResult = this.evaluator.eval(node.target.object);
			if (!objResult.error && isPointerType(objResult.value.type)) {
				const heapAddr = objResult.value.data ?? 0;
				if (this.memory.isFreedAddress(heapAddr)) {
					this.errors.push(`Use-after-free: writing to freed memory at ${formatAddress(heapAddr)}`);
					return;
				}
			}

			if (!objResult.error) {
				if (isPointerType(objResult.value.type)) {
					const heapAddr = objResult.value.data ?? 0;
					const block = this.memory.getHeapBlock(heapAddr);
					if (block && isArrayType(block.type) && (index < 0 || index >= block.type.size)) {
						this.errors.push(`Heap buffer overflow: index ${index} out of bounds (size ${block.type.size}) at line ${node.line}`);
						return;
					}
				} else if (isArrayType(objResult.value.type)) {
					if (index < 0 || index >= objResult.value.type.size) {
						this.errors.push(`Array index ${index} out of bounds (size ${objResult.value.type.size}) at line ${node.line}`);
						return;
					}
				}
			}

			const newVal = rhs.value.data ?? 0;
			const displayVal = String(newVal);

			const targetEval = this.evaluator.eval(node.target);
			if (targetEval.value.address) {
				this.memory.writeMemory(targetEval.value.address, newVal);
			}

			const heapBlockId = this.memory.resolvePointerPath(objPath);
			if (heapBlockId) {
				this.memory.directSetValue(`${heapBlockId}-${index}`, displayVal);
			} else {
				const parentId = this.memory.resolvePathId(objPath);
				if (parentId) {
					this.memory.directSetValue(`${parentId}-${index}`, displayVal);
				}
			}
		}
	}

	// === Expression statements ===

	private executeExpressionStatement(node: ASTNode & { type: 'expression_statement' }, sharesStep: boolean): void {
		const expr = node.expression;

		if (expr.type === 'call_expression') {
			this.executeCallStatement(expr, node.line, sharesStep);
			return;
		}

		if (expr.type === 'assignment') {
			this.executeAssignment({ ...expr, line: node.line } as any, sharesStep);
			return;
		}

		// Unary increment/decrement as statement
		if (expr.type === 'unary_expression' && (expr.operator === '++' || expr.operator === '--')) {
			const targetEval = this.evaluator.eval(expr.operand);
			if (targetEval.error) { this.errors.push(targetEval.error); return; }
			const oldVal = targetEval.value.data ?? this.memory.readMemory(targetEval.value.address) ?? 0;
			const step = isPointerType(targetEval.value.type) ? sizeOf(targetEval.value.type.pointsTo) : 1;
			const newVal = expr.operator === '++' ? (oldVal + step) | 0 : (oldVal - step) | 0;

			if (!sharesStep) {
				const name = expr.operand.type === 'identifier' ? expr.operand.name : '';
				const desc = name
					? (expr.prefix ? `${expr.operator}${name}` : `${name}${expr.operator}`)
					: `${expr.operator}`;
				this.memory.beginStep({ line: node.line }, desc);
				this.stepCount++;
			}

			if (expr.operand.type === 'identifier') {
				this.memory.setVariable(expr.operand.name, newVal);
				const current = this.memory.lookupVariable(expr.operand.name);
				if (current) {
					this.memory.assignVariable(expr.operand.name, this.formatValue(current.type, current.data));
				}
			} else if (expr.operand.type === 'subscript_expression') {
				const addr = targetEval.value.address;
				if (addr) this.memory.writeMemory(addr, newVal);
				const objPath = Evaluator.buildAccessPath(expr.operand.object);
				const idxResult = this.evaluator.eval(expr.operand.index);
				const index = idxResult.value?.data ?? 0;
				const heapBlockId = this.memory.resolvePointerPath(objPath);
				if (heapBlockId) {
					this.memory.directSetValue(`${heapBlockId}-${index}`, String(newVal));
				} else {
					const parentId = this.memory.resolvePathId(objPath);
					if (parentId) {
						this.memory.directSetValue(`${parentId}-${index}`, String(newVal));
					}
				}
			} else if (expr.operand.type === 'member_expression') {
				const addr = targetEval.value.address;
				if (addr) this.memory.writeMemory(addr, newVal);
				const path = Evaluator.buildAccessPath(expr.operand);
				this.memory.assignField(path, String(newVal));
			}
			return;
		}

		// Evaluate for side effects
		const result = this.evaluator.eval(expr);
		if (result.error) this.errors.push(result.error);
	}

	private executeCallStatement(call: ASTNode & { type: 'call_expression' }, line: number, sharesStep: boolean): void {
		if (call.callee === 'free') {
			this.executeFreeCall(call, line, sharesStep);
			return;
		}

		if (call.callee === 'sprintf' && call.args.length >= 2) {
			const destResult = this.evaluator.eval(call.args[0]);
			const formatted = this.evaluateSprintfResult(call);

			if (!sharesStep) {
				this.memory.beginStep({ line }, `sprintf(${this.describeExpr(call.args[0])}, ...) — write "${formatted}"`);
				this.stepCount++;
			}

			if (!destResult.error && destResult.value.data) {
				const destName = call.args[0].type === 'identifier' ? call.args[0].name : undefined;
				if (destName) {
					const blockId = this.memory.getHeapBlockId(destName);
					if (blockId) {
						this.memory.directSetValue(blockId, `"${formatted}"`);
					}
				}
			}
			return;
		}

		if (call.callee === 'printf' || call.callee === 'puts') {
			if (!sharesStep) {
				this.memory.beginStep({ line }, this.formatPrintfDesc(call));
				this.stepCount++;
			}
			return;
		}

		// User-defined function call as statement
		const fn = this.memory.getFunction(call.callee);
		if (fn) {
			this.executeUserFunctionCall(fn, call, line, sharesStep);
			return;
		}

		// Function pointer call as statement
		const fpVar = this.memory.lookupVariable(call.callee);
		if (fpVar && isFunctionPointerType(fpVar.type)) {
			const idx = fpVar.data ?? 0;
			if (idx === 0) {
				this.errors.push(`Null function pointer call '${call.callee}' at line ${line}`);
				return;
			}
			const target = this.memory.getFunctionByIndex(idx);
			if (target) {
				this.executeUserFunctionCall(target.node, call, line, sharesStep);
				return;
			}
			this.errors.push(`Invalid function pointer '${call.callee}' at line ${line}`);
			return;
		}

		// Stdlib call
		if (!sharesStep) {
			const argDescs = call.args.map(a => this.describeExpr(a)).join(', ');
			this.memory.beginStep({ line }, `${call.callee}(${argDescs})`);
			this.stepCount++;
		}
		const result = this.evaluator.eval(call);
		if (result.error) this.errors.push(result.error);

		if (call.callee === 'strcpy' || call.callee === 'strcat') {
			this.updateHeapChildrenFromMemory(call.args[0]);
		}
	}

	private executeFreeCall(call: ASTNode & { type: 'call_expression' }, line: number, sharesStep: boolean): void {
		if (call.args.length === 0) return;

		const argPath = Evaluator.buildAccessPath(call.args[0]);
		const result = this.evaluator.eval(call.args[0]);
		if (result.error) {
			this.errors.push(result.error);
			return;
		}

		const ptrAddr = result.value.data ?? 0;
		const freeResult = this.memory.freeByAddress(ptrAddr);
		if (freeResult.error) {
			this.errors.push(freeResult.error);
			return;
		}

		if (!sharesStep) {
			const argText = this.describeExpr(call.args[0]);
			this.memory.beginStep({ line }, `free(${argText}) — deallocate memory`);
			this.stepCount++;
		}

		const varName = argPath[0];
		if (argPath.length === 1) {
			// freeByAddress already marked the block freed in runtime.
			// Now emit the visualization op.
			const blockId = this.memory.getHeapBlockId(varName);
			if (blockId) {
				this.memory.directFreeHeap(blockId);
			}
			this.memory.assignVariable(varName, '(dangling)');
		} else {
			const fieldName = argPath[argPath.length - 1];
			const blockId = this.memory.getHeapBlockId(fieldName)
				?? this.memory.getHeapBlockIdByAddress(ptrAddr);
			if (blockId) {
				this.memory.directFreeHeap(blockId);
			}
			const entryId = this.memory.resolvePointerPath(argPath);
			if (entryId) {
				this.memory.directSetValue(entryId, '(dangling)');
			}
		}
	}

	// === Return ===

	private executeReturn(node: ASTNode & { type: 'return_statement' }, sharesStep: boolean): void {
		let value: CValue | null = null;
		let displayVal = '0';

		if (node.value) {
			const result = this.evaluator.eval(node.value);
			if (result.error) this.errors.push(result.error);
			value = result.value;
			displayVal = String(value.data ?? 0);
		}

		if (!sharesStep) {
			this.memory.beginStep({ line: node.line }, `return ${displayVal}`);
			this.stepCount++;
		}

		this.returnFlag = true;
		this.returnValue = value;
	}

	// === Control flow ===

	private executeIf(node: ASTNode & { type: 'if_statement' }): void {
		const condResult = this.evaluator.eval(node.condition);
		if (condResult.error) {
			this.errors.push(condResult.error);
			return;
		}

		const taken = (condResult.value.data ?? 0) !== 0;
		const condText = this.describeExpr(node.condition);

		this.memory.beginStep(
			{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
			`if: ${condText} → ${taken ? 'true' : 'false'}`,
		);
		this.stepCount++;

		if (taken) {
			this.executeStatement(node.consequent);
		} else if (node.alternate) {
			this.executeStatement(node.alternate);
		}
	}

	private executeFor(node: ASTNode & { type: 'for_statement' }): void {
		const hasDecl = node.init?.type === 'declaration';

		if (node.init) {
			this.memory.beginStep({ line: node.line }, `for: ${this.describeForInit(node.init)}`);
			this.stepCount++;

			if (hasDecl) {
				this.memory.pushScopeRuntime('for');
				this.memory.pushBlock('for');
			}

			this.executeStatement(node.init, true);
			if (!hasDecl) {
				this.memory.pushScopeRuntime('for');
				this.memory.pushBlock('for');
			}
		} else {
			this.memory.beginStep({ line: node.line }, 'for: init');
			this.stepCount++;
			this.memory.pushScopeRuntime('for');
			this.memory.pushBlock('for');
		}

		let iteration = 0;
		while (iteration < this.maxSteps) {
			if (this.stepCount >= this.maxSteps) {
				this.errors.push(`Step limit exceeded (${this.maxSteps})`);
				break;
			}

			if (node.condition) {
				const condResult = this.evaluator.eval(node.condition);
				if (condResult.error) {
					this.errors.push(condResult.error);
					break;
				}

				const condVal = condResult.value.data ?? 0;

				if (condVal === 0) {
					const condText = this.describeExpr(node.condition);
					this.memory.beginStep(
						{ line: node.line, colStart: node.condColStart, colEnd: node.condColEnd },
						`for: check ${condText} → false, exit loop`,
						`${condText} → false`,
					);
					this.stepCount++;
					break;
				}

				const condText = this.describeExpr(node.condition);
				this.memory.beginStep(
					{ line: node.line, colStart: node.condColStart, colEnd: node.condColEnd },
					`for: check ${condText} → true`,
					`${condText} → true`,
				);
				this.memory.markSubStep();
				this.stepCount++;
			}

			this.executeStatement(node.body);

			if (this.breakFlag) {
				this.breakFlag = false;
				break;
			}
			if (this.continueFlag) {
				this.continueFlag = false;
			}
			if (this.returnFlag) break;

			if (node.update) {
				const beforeVal = this.describeUpdateBefore(node.update);
				const result = this.evaluator.eval(node.update);
				if (result.error) this.errors.push(result.error);

				let afterVal = result.value.data ?? 0;
				let varName: string | undefined;
				if (node.update.type === 'unary_expression' && node.update.operand.type === 'identifier') {
					varName = node.update.operand.name;
				} else if (node.update.type === 'assignment' && node.update.target.type === 'identifier') {
					varName = node.update.target.name;
				}
				if (varName) {
					const current = this.memory.lookupVariable(varName);
					if (current) afterVal = current.data ?? afterVal;
				}

				this.memory.beginStep(
					{ line: node.line, colStart: node.updateColStart, colEnd: node.updateColEnd },
					`for: ${beforeVal} → ${this.describeUpdateResult(node.update, afterVal)}`,
				);
				this.memory.markSubStep();
				this.stepCount++;

				if (varName) {
					this.memory.assignVariable(varName, String(afterVal));
				}
			}

			iteration++;
		}

		// Exit block
		this.memory.popBlock();
		this.memory.popScopeRuntime();
	}

	private executeWhile(node: ASTNode & { type: 'while_statement' }): void {
		let iteration = 0;
		const hasDecls = this.bodyHasDeclarations(node.body);
		const condText = this.describeExpr(node.condition);

		if (hasDecls) {
			this.memory.beginStep({ line: node.line }, 'Enter while loop');
			this.stepCount++;
			this.memory.pushScopeRuntime('while');
			this.memory.pushBlock('while');
		}

		while (iteration < this.maxSteps) {
			if (this.stepCount >= this.maxSteps) {
				this.errors.push(`Step limit exceeded (${this.maxSteps})`);
				break;
			}

			const condResult = this.evaluator.eval(node.condition);
			if (condResult.error) {
				this.errors.push(condResult.error);
				break;
			}

			if ((condResult.value.data ?? 0) === 0) {
				this.memory.beginStep(
					{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
					`while: ${condText} → false, exit`,
				);
				this.stepCount++;
				break;
			}

			this.memory.beginStep(
				{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
				`while: check ${condText} → true`,
			);
			this.memory.markSubStep();
			this.stepCount++;

			if (node.body.type === 'compound_statement') {
				this.executeStatements(node.body.children);
			} else {
				this.executeStatement(node.body);
			}

			if (this.breakFlag) { this.breakFlag = false; break; }
			if (this.continueFlag) { this.continueFlag = false; }
			if (this.returnFlag) break;

			iteration++;
		}

		if (hasDecls) {
			this.memory.popBlock();
			this.memory.popScopeRuntime();
		}
	}

	private executeDoWhile(node: ASTNode & { type: 'do_while_statement' }): void {
		let iteration = 0;
		const hasDecls = this.bodyHasDeclarations(node.body);
		const condText = this.describeExpr(node.condition);

		if (hasDecls) {
			this.memory.beginStep({ line: node.line }, 'Enter do-while loop');
			this.stepCount++;
			this.memory.pushScopeRuntime('do-while');
			this.memory.pushBlock('do-while');
		}

		do {
			if (this.stepCount >= this.maxSteps) {
				this.errors.push(`Step limit exceeded (${this.maxSteps})`);
				break;
			}

			if (node.body.type === 'compound_statement') {
				this.executeStatements(node.body.children);
			} else {
				this.executeStatement(node.body);
			}

			if (this.breakFlag) { this.breakFlag = false; break; }
			if (this.continueFlag) { this.continueFlag = false; }
			if (this.returnFlag) break;

			const condResult = this.evaluator.eval(node.condition);
			if (condResult.error) {
				this.errors.push(condResult.error);
				break;
			}

			if ((condResult.value.data ?? 0) === 0) {
				this.memory.beginStep(
					{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
					`do-while: ${condText} → false, exit`,
				);
				this.stepCount++;
				break;
			}

			this.memory.beginStep(
				{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
				`do-while: check ${condText} → true`,
			);
			this.memory.markSubStep();
			this.stepCount++;

			iteration++;
		} while (iteration < this.maxSteps);

		if (hasDecls) {
			this.memory.popBlock();
			this.memory.popScopeRuntime();
		}
	}

	private executeSwitch(node: ASTNode & { type: 'switch_statement' }): void {
		const condResult = this.evaluator.eval(node.expression);
		if (condResult.error) {
			this.errors.push(condResult.error);
			return;
		}

		const switchValue = condResult.value.data ?? 0;
		const condText = this.describeExpr(node.expression);

		this.memory.beginStep({ line: node.line }, `switch: ${condText} = ${switchValue}`);
		this.stepCount++;

		let matchIndex = -1;
		let defaultIndex = -1;
		for (let i = 0; i < node.cases.length; i++) {
			const clause = node.cases[i];
			if (clause.kind === 'default') {
				defaultIndex = i;
			} else if (clause.value) {
				const caseResult = this.evaluator.eval(clause.value);
				if (!caseResult.error && (caseResult.value.data ?? 0) === switchValue) {
					matchIndex = i;
					break;
				}
			}
		}

		const startIndex = matchIndex >= 0 ? matchIndex : defaultIndex;
		if (startIndex < 0) return;

		const savedBreak = this.breakFlag;
		this.breakFlag = false;

		for (let i = startIndex; i < node.cases.length; i++) {
			const clause = node.cases[i];
			this.executeStatements(clause.statements);

			if (this.breakFlag) {
				this.breakFlag = false;
				break;
			}
			if (this.returnFlag || this.continueFlag) break;
			if (this.stepCount >= this.maxSteps) break;
		}

		this.breakFlag = savedBreak;
	}

	private executeBlock(node: ASTNode & { type: 'compound_statement' }): void {
		const hasDecls = node.children.some((c) => c.type === 'declaration');

		if (hasDecls) {
			this.memory.beginStep({ line: node.line }, 'Enter block scope');
			this.stepCount++;
			this.memory.pushScopeRuntime('block');
			this.memory.pushBlock('{ }');
		}

		this.executeStatements(node.children);

		if (hasDecls) {
			this.memory.beginStep(
				{ line: this.findClosingLine(node) },
				'Exit block scope',
			);
			this.stepCount++;
			this.memory.popBlock();
			this.memory.popScopeRuntime();
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

		// Push scope and declare params in runtime first (to get addresses)
		this.memory.pushScopeRuntime(fn.name);
		const declaredParams: CValue[] = [];
		for (let i = 0; i < fn.params.length; i++) {
			const paramType = this.typeReg.resolve(fn.params[i].typeSpec);
			const arg = args[i] ? Evaluator.decayArrayToPointer(args[i]) : undefined;
			const v = this.memory.declareVariableRuntime(fn.params[i].name, paramType, arg?.data ?? 0);
			declaredParams.push(v);
		}

		// Register pointer parameter names in pointer target map
		for (let i = 0; i < fn.params.length; i++) {
			const paramType = this.typeReg.resolve(fn.params[i].typeSpec);
			if (isPointerType(paramType) && args[i]?.data != null && args[i].data !== 0) {
				const blockId = this.memory.getHeapBlockIdByAddress(args[i].data!);
				if (blockId) {
					this.memory.setPointerTarget(fn.params[i].name, blockId);
				}
			}
		}

		// Build params with addresses for op emission
		const params = fn.params.map((p, i) => {
			const paramType = this.typeReg.resolve(p.typeSpec);
			const argVal = args[i]?.data ?? 0;
			let children: ChildSpec[] | undefined;

			if (isStructType(paramType)) {
				const srcAddr = args[i]?.address ?? 0;
				const initValues = new Map<string, string>();
				for (const field of paramType.fields) {
					const fieldAddr = srcAddr + field.offset;
					const val = this.memory.readMemory(fieldAddr);
					if (val !== undefined) {
						initValues.set(field.name, String(val));
					}
				}
				children = buildStructChildSpecs(paramType, initValues);

				const destAddr = declaredParams[i].address;
				for (const field of paramType.fields) {
					const srcFieldAddr = srcAddr + field.offset;
					const destFieldAddr = destAddr + field.offset;
					const val = this.memory.readMemory(srcFieldAddr);
					if (val !== undefined) {
						this.memory.writeMemory(destFieldAddr, val);
					}
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

		// Emit call step
		const callColStart = this.callDeclContext?.colStart;
		const callColEnd = this.callDeclContext?.colEnd;
		this.memory.beginStep(
			{ line, colStart: callColStart, colEnd: callColEnd },
			`Call ${fn.name}(${params.map((p) => p.name).join(', ')}) — push stack frame`,
		);
		this.stepCount++;

		// Emit scope entry + param variable entries
		this.memory.emitScopeEntry(fn.name, params, {
			caller: `${callerName}()`,
			file: '',
			line: fn.line,
		});

		// Emit param variable entries
		for (const param of params) {
			if (param.address !== undefined) {
				this.memory.emitVariableEntry(param.name, param.type, param.value, param.address, param.children);
			}
		}

		// Execute body
		this.returnFlag = false;
		this.returnValue = null;

		if (fn.body.type === 'compound_statement') {
			this.executeStatements(fn.body.children);
		}

		const retVal = this.returnValue ?? { type: primitiveType('int'), data: 0, address: 0 };
		this.returnFlag = false;
		this.returnValue = null;

		// Emit return step (pop frame)
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

	private executeUserFunctionCall(
		fn: ASTNode & { type: 'function_definition' },
		call: ASTNode & { type: 'call_expression' },
		line: number,
		sharesStep: boolean,
	): void {
		const args = call.args.map((a) => {
			const r = this.evaluator.eval(a);
			if (r.error) this.errors.push(r.error);
			return r.value;
		});

		const result = this.callFunction(fn, args, line);
		if (result.error) this.errors.push(result.error);
	}

	// === Leak detection ===

	private detectLeaks(): void {
		const blocks = this.memory.getAllHeapBlocks();
		for (const [addr, block] of blocks) {
			if (block.status === 'allocated') {
				const blockId = this.memory.getHeapBlockIdByAddress(addr);
				if (blockId) {
					this.memory.directLeakHeap(blockId);
				}
			}
		}
	}

	// === Helpers ===

	private updateHeapChildrenFromMemory(destArg: ASTNode): void {
		if (destArg.type !== 'identifier') return;
		const ptrVar = this.memory.lookupVariable(destArg.name);
		if (!ptrVar || !ptrVar.data) return;
		const baseAddr = ptrVar.data;
		const block = this.memory.getHeapBlock(baseAddr);
		if (!block) return;
		const blockId = this.memory.getHeapBlockId(destArg.name);
		if (!blockId) return;
		for (let i = 0; i < block.size; i++) {
			const val = this.memory.readMemory(baseAddr + i);
			if (val !== undefined) {
				this.memory.directSetValue(`${blockId}-${i}`, String(val));
			}
		}
	}

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

	private formatDeclDescription(name: string, type: CType, value: string): string {
		const typeStr = typeToString(type);
		if (isStructType(type)) {
			return `${typeStr} ${name} = {...}`;
		}
		if (isArrayType(type)) {
			return `${typeStr} ${name} = {...}`;
		}
		return `${typeStr} ${name} = ${value}`;
	}

	private formatAssignDesc(node: ASTNode & { type: 'assignment' }): string {
		const target = this.describeExpr(node.target);
		const value = this.describeExpr(node.value);

		if (node.operator === '=') {
			return `${target} = ${value}`;
		}
		return `${target} ${node.operator} ${value}`;
	}

	private formatMallocArgs(call: ASTNode & { type: 'call_expression' }): string {
		return call.args.map((a) => this.describeExpr(a)).join(', ');
	}

	private evaluateSprintfResult(call: ASTNode & { type: 'call_expression' }): string {
		if (call.args.length < 2) return '';
		const fmtResult = this.evaluator.eval(call.args[1]);
		let fmt = '';
		if (call.args[1].type === 'string_literal') {
			fmt = (call.args[1] as any).value ?? '';
		} else {
			return '';
		}

		let argIdx = 2;
		let result = '';
		for (let i = 0; i < fmt.length; i++) {
			if (fmt[i] === '%' && i + 1 < fmt.length) {
				i++;
				if (fmt[i] === '%') {
					result += '%';
				} else if (argIdx < call.args.length) {
					const argResult = this.evaluator.eval(call.args[argIdx]);
					const val = argResult.value?.data ?? 0;
					switch (fmt[i]) {
						case 'd': case 'i': result += String(val); break;
						case 's': result += '(string)'; break;
						case 'x': result += val.toString(16); break;
						case 'c': result += String.fromCharCode(val); break;
						default: result += `%${fmt[i]}`;
					}
					argIdx++;
				}
			} else {
				result += fmt[i];
			}
		}
		return result;
	}

	private formatPrintfDesc(call: ASTNode & { type: 'call_expression' }): string {
		const args = call.args.map((a) => this.describeExpr(a)).join(', ');
		return `${call.callee}(${args})`;
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

	private describeForInit(node: ASTNode): string {
		if (node.type === 'declaration') {
			return `${typeToString(this.typeReg.resolve(node.declType))} ${node.name} = ${node.initializer ? this.describeExpr(node.initializer) : '0'}`;
		}
		return this.describeExpr(node);
	}

	private describeUpdateBefore(node: ASTNode): string {
		if (node.type === 'unary_expression' && node.operand.type === 'identifier') {
			return `${node.operand.name}${node.operator}`;
		}
		return this.describeExpr(node);
	}

	private describeUpdateResult(node: ASTNode, value: number): string {
		if (node.type === 'unary_expression' && node.operand.type === 'identifier') {
			return `${node.operand.name} = ${value}`;
		}
		return String(value);
	}

	private applyCompoundOp(op: string, oldVal: number, newVal: number): number {
		switch (op) {
			case '=': return newVal;
			case '+=': return (oldVal + newVal) | 0;
			case '-=': return (oldVal - newVal) | 0;
			case '*=': return Math.imul(oldVal, newVal);
			case '/=': return newVal === 0 ? 0 : (Math.trunc(oldVal / newVal)) | 0;
			case '%=': return newVal === 0 ? 0 : (oldVal % newVal) | 0;
			case '&=': return oldVal & newVal;
			case '|=': return oldVal | newVal;
			case '^=': return oldVal ^ newVal;
			case '<<=': return oldVal << newVal;
			case '>>=': return oldVal >> newVal;
			default: return newVal;
		}
	}

	private findFirstStatementLine(body: ASTNode): number {
		if (body.type === 'compound_statement' && body.children.length > 0) {
			return this.getLine(body.children[0]);
		}
		return this.getLine(body);
	}

	private findClosingLine(node: ASTNode): number {
		if (node.type === 'compound_statement' && node.children.length > 0) {
			return this.getLine(node.children[node.children.length - 1]) + 1;
		}
		return this.getLine(node);
	}

	private getLine(node: ASTNode): number {
		if ('line' in node) return node.line as number;
		return 1;
	}

	private bodyHasDeclarations(body: ASTNode): boolean {
		if (body.type === 'compound_statement') {
			return body.children.some((c) => c.type === 'declaration');
		}
		return false;
	}

	private initStructFromList(type: CType & { kind: 'struct' }, children: ChildSpec[], values: ASTNode[], baseAddress?: number): void {
		for (let i = 0; i < Math.min(type.fields.length, values.length); i++) {
			const field = type.fields[i];
			if (isStructType(field.type) && values[i].type === 'init_list') {
				const nestedChildren = children[i].children;
				if (nestedChildren) {
					const nestedBase = baseAddress !== undefined ? baseAddress + field.offset : undefined;
					this.initStructFromList(field.type, nestedChildren, values[i].values, nestedBase);
				}
				continue;
			}
			const result = this.evaluator.eval(values[i]);
			if (result.error) this.errors.push(result.error);
			const val = result.value.data ?? 0;
			children[i].value = String(val);
			if (baseAddress !== undefined) {
				this.memory.writeMemory(baseAddress + field.offset, val);
			}
		}
	}
}
