import type { ASTNode, CType, CValue, InterpreterOptions, ChildSpec } from './types';
import type { SourceLocation } from '$lib/api/types';
import { Environment, formatAddress } from './environment';
import { DefaultEmitter } from './emitter';
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
	private env: Environment;
	private emitter: DefaultEmitter;
	private evaluator: Evaluator;
	private typeReg: TypeRegistry;
	private errors: string[] = [];
	private stepCount = 0;
	private frameDepth = 0;
	private maxSteps: number;
	private maxFrames: number;
	private source: string;

	// Value tracking for heap/array elements (address → numeric value)
	private memoryValues = new Map<number, number>();

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

		this.env = new Environment(maxHeap);
		this.typeReg = new TypeRegistry();
		this.emitter = new DefaultEmitter('Custom Program', source);

		const stdlib = createStdlib(this.env, this.typeReg, this.emitter);

		this.evaluator = new Evaluator(this.env, this.typeReg, (name, args, line) => {
			// Check user-defined functions first
			const fn = this.env.getFunction(name);
			if (fn) {
				return this.callFunction(fn, args, line);
			}
			// Then stdlib
			return stdlib(name, args, line);
		});

		// Wire up memory reader so evaluator can read heap/array values
		this.evaluator.setMemoryReader((address) => this.memoryValues.get(address));
	}

	run(): InterpretResult {
		// This is called with an already-parsed AST from the public interpret() function
		// For now, return empty — the public API uses interpretAST()
		return this.emitter.finish() as InterpretResult;
	}

	interpretAST(ast: ASTNode & { type: 'translation_unit' }): InterpretResult {
		// First pass: register struct definitions and function definitions
		for (const node of ast.children) {
			if (node.type === 'struct_definition') {
				this.typeReg.defineStruct(node.name, node.fields);
			} else if (node.type === 'function_definition' && node.name !== 'main') {
				this.env.defineFunction(node.name, node);
			}
		}

		// Find and execute main
		const mainFn = ast.children.find(
			(n) => n.type === 'function_definition' && n.name === 'main'
		);

		if (!mainFn || mainFn.type !== 'function_definition') {
			this.errors.push('No main() function found');
			return { ...this.emitter.finish(), errors: this.errors };
		}

		this.env.defineFunction('main', mainFn);
		this.executeMainFunction(mainFn);

		const result = this.emitter.finish();
		return {
			program: result.program,
			errors: [...this.errors, ...result.errors],
		};
	}

	private executeMainFunction(fn: ASTNode & { type: 'function_definition' }): void {
		const firstLine = this.findFirstStatementLine(fn.body);
		this.emitter.beginStep(
			{ line: firstLine },
			`Enter main()`,
		);
		this.env.pushScope('main');
		this.emitter.enterFunction('main', [], {
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
			case 'compound_statement':
				this.executeBlock(node);
				break;
			case 'break_statement':
				this.breakFlag = true;
				break;
			case 'continue_statement':
				this.continueFlag = true;
				break;
			case 'struct_definition':
				// Already processed in first pass
				break;
			case 'function_definition':
				// Already processed in first pass
				break;
			case 'preproc_include':
				// Skip
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
			// Struct declaration
			value = this.env.declareVariable(node.name, type);
			displayValue = '';
			children = buildStructChildSpecs(type);

			if (node.initializer?.type === 'init_list') {
				this.initStructFromList(type, children, node.initializer.values, value.address);
			}
		} else if (isArrayType(type)) {
			// Array declaration
			value = this.env.declareVariable(node.name, type);
			displayValue = '';

			let initValues: string[] | undefined;
			if (node.initializer?.type === 'init_list') {
				initValues = node.initializer.values.map((v, i) => {
					const result = this.evaluator.eval(v);
					if (result.error) this.errors.push(result.error);
					const val = result.value.data ?? 0;
					// Store in memoryValues so element values can be read back
					const elemSize = sizeOf(type.elementType);
					this.memoryValues.set(value.address + i * elemSize, val);
					return String(val);
				});
			}

			children = buildArrayChildSpecs(type.elementType, type.size, initValues);
		} else {
			// Scalar declaration
			let initData: number | null = 0;
			let initWasFunctionCall = false;
			if (node.initializer) {
				// Handle call expressions that return heap pointers or function calls
				if (node.initializer.type === 'call_expression') {
					const callResult = this.evaluateCallForDecl(node, type);
					if (callResult.handled) return; // malloc/calloc handler already emitted the step
					if (callResult.value !== undefined) {
						initData = callResult.value;
						initWasFunctionCall = true;
					}
				} else {
					const result = this.evaluator.eval(node.initializer);
					if (result.error) this.errors.push(result.error);
					initData = result.value.data;
				}
			}
			value = this.env.declareVariable(node.name, type, initData);
			displayValue = this.formatValue(type, initData);

			// If initializer was a function call, the return step is already active —
			// append the variable declaration ops to it instead of creating a new step
			if (initWasFunctionCall) {
				sharesStep = true;
			}
		}

		if (!sharesStep) {
			this.emitter.beginStep(
				{ line: node.line },
				this.formatDeclDescription(node.name, type, displayValue!),
			);
			this.stepCount++;
		}

		if (children) {
			this.emitter.declareVariableWithAddress(node.name, type, displayValue!, value!.address, children);
		} else {
			this.emitter.declareVariableWithAddress(node.name, type, displayValue!, value!.address);
		}
	}

	private evaluateCallForDecl(
		node: ASTNode & { type: 'declaration' },
		declType: CType,
	): { handled: boolean; value?: number | null } {
		if (node.initializer?.type !== 'call_expression') return { handled: false };
		const call = node.initializer;

		if (call.callee === 'malloc' || call.callee === 'calloc') {
			const handled = this.executeMallocDecl(node, call, declType);
			return { handled };
		}

		// Regular function call — set context so callFunction can produce better descriptions
		this.callDeclContext = {
			varName: node.name,
			colStart: (call as any).colStart,
			colEnd: (call as any).colEnd,
		};
		const result = this.evaluator.eval(call);
		this.callDeclContext = null;
		if (result.error) this.errors.push(result.error);
		return { handled: false, value: result.value.data };
	}

	private executeMallocDecl(
		decl: ASTNode & { type: 'declaration' },
		call: ASTNode & { type: 'call_expression' },
		declType: CType,
	): boolean {
		// Evaluate args
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

			// Infer array type from pointer type
			if (isPointerType(declType)) {
				heapType = arrayType(declType.pointsTo, count);
			} else {
				heapType = primitiveType('void');
			}
		} else {
			totalSize = args[0]?.data ?? 0;
			allocator = 'malloc';

			// Infer heap type from pointer type
			if (isPointerType(declType)) {
				heapType = declType.pointsTo;
			} else {
				heapType = primitiveType('void');
			}
		}

		// Allocate
		const { address, error } = this.env.malloc(totalSize, allocator, decl.line);
		if (error) {
			this.errors.push(error);
			return true;
		}

		this.env.setHeapBlockType(address, heapType);

		// Declare the pointer variable
		const ptrValue = this.env.declareVariable(decl.name, declType, address);

		// Build heap children
		let heapChildren: ChildSpec[] | undefined;
		if (isStructType(heapType)) {
			heapChildren = buildStructChildSpecs(heapType);
		} else if (isArrayType(heapType)) {
			heapChildren = buildArrayChildSpecs(heapType.elementType, heapType.size);
		}

		// Emit step
		const sizeDesc = `${totalSize}`;
		const desc = `${allocator}(${this.formatMallocArgs(call)}) — allocate ${sizeDesc} bytes`;

		this.emitter.beginStep({ line: decl.line }, desc);
		this.stepCount++;

		// Emit heap allocation
		this.emitter.allocHeapWithAddress(
			decl.name,
			heapType,
			totalSize,
			allocator,
			{ line: decl.line },
			address,
			heapChildren,
		);

		// Emit pointer variable
		this.emitter.declareVariableWithAddress(
			decl.name,
			declType,
			formatAddress(address),
			ptrValue.address,
		);

		return true;
	}

	private executeMallocAssign(
		node: ASTNode & { type: 'assignment' },
		call: ASTNode & { type: 'call_expression' },
		sharesStep: boolean,
	): void {
		// Evaluate args
		const args = call.args.map((a) => {
			const r = this.evaluator.eval(a);
			if (r.error) this.errors.push(r.error);
			return r.value;
		});

		// Determine target type for heap type inference
		let targetType: CType | undefined;
		if (node.target.type === 'identifier') {
			const existing = this.env.lookupVariable(node.target.name);
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
				heapType = targetType.pointsTo;
			} else {
				heapType = primitiveType('void');
			}
		}

		const { address, error } = this.env.malloc(totalSize, allocator, node.line);
		if (error) {
			this.errors.push(error);
			return;
		}

		let heapChildren: ChildSpec[] | undefined;
		if (isStructType(heapType)) {
			heapChildren = buildStructChildSpecs(heapType);
		} else if (isArrayType(heapType)) {
			heapChildren = buildArrayChildSpecs(heapType.elementType, heapType.size);
		}

		if (!sharesStep) {
			const desc = `${allocator}(${this.formatMallocArgs(call)}) — allocate ${totalSize} bytes`;
			this.emitter.beginStep({ line: node.line }, desc);
			this.stepCount++;
		}

		if (node.target.type === 'identifier') {
			const varName = node.target.name;
			this.env.setVariable(varName, address);
			this.emitter.allocHeapWithAddress(
				varName, heapType, totalSize, allocator,
				{ line: node.line }, address, heapChildren,
			);
			this.emitter.assignVariable(varName, formatAddress(address));
		} else if (node.target.type === 'member_expression') {
			// p->scores = calloc(...) — allocate and assign to struct field
			const path = Evaluator.buildAccessPath(node.target);
			const fieldName = path[path.length - 1];

			// Store address in memoryValues at the field's address
			const targetEval = this.evaluator.eval(node.target);
			if (targetEval.value.address) {
				this.memoryValues.set(targetEval.value.address, address);
			}

			// Use the field name as the pointer key for heap tracking
			this.emitter.allocHeapWithAddress(
				fieldName, heapType, totalSize, allocator,
				{ line: node.line }, address, heapChildren,
			);

			// Update the field display value to the hex address
			const entryId = this.emitter.resolvePointerPath(path);
			if (entryId) {
				this.emitter.assignField(path, formatAddress(address));
			}
		}
	}

	// === Assignments ===

	private executeAssignment(node: ASTNode & { type: 'assignment' }, sharesStep: boolean): void {
		// Intercept malloc/calloc in assignment RHS: p = malloc(n) or p->field = calloc(...)
		if (node.operator === '=' && node.value?.type === 'call_expression') {
			const call = node.value;
			if ((call.callee === 'malloc' || call.callee === 'calloc') &&
				(node.target?.type === 'identifier' || node.target?.type === 'member_expression')) {
				this.executeMallocAssign(node, call, sharesStep);
				return;
			}
		}

		const rhs = this.evaluator.eval(node.value);
		if (rhs.error) {
			this.errors.push(rhs.error);
			return;
		}

		if (!sharesStep) {
			this.emitter.beginStep({ line: node.line }, this.formatAssignDesc(node));
			this.stepCount++;
		}

		if (node.target.type === 'identifier') {
			// Simple variable assignment
			const existing = this.env.lookupVariable(node.target.name);
			if (!existing) {
				this.errors.push(`Undefined variable '${node.target.name}' at line ${node.line}`);
				return;
			}

			let newVal = rhs.value.data ?? 0;
			const oldVal = existing.data ?? 0;
			newVal = this.applyCompoundOp(node.operator, oldVal, newVal);
			this.env.setVariable(node.target.name, newVal);

			const displayVal = this.formatValue(existing.type, newVal);
			this.emitter.assignVariable(node.target.name, displayVal);
		} else if (node.target.type === 'member_expression') {
			// Field assignment: p->x = 10, p.x = 10, p->pos.x = 10
			const path = Evaluator.buildAccessPath(node.target);
			let newVal = rhs.value.data ?? 0;

			// For compound operators, apply old value
			if (node.operator !== '=') {
				const targetEval = this.evaluator.eval(node.target);
				const oldVal = targetEval.value.data ?? this.memoryValues.get(targetEval.value.address) ?? 0;
				newVal = this.applyCompoundOp(node.operator, oldVal, newVal);
			}

			const displayVal = String(newVal);

			// Store value at the field's address for future reads
			const targetEval = this.evaluator.eval(node.target);
			if (targetEval.value.address) {
				this.memoryValues.set(targetEval.value.address, newVal);
			}

			const entryId = this.emitter.resolvePointerPath(path);
			if (entryId) {
				this.emitter.directSetValue(entryId, displayVal);
			}
		} else if (node.target.type === 'unary_expression' && node.target.operator === '*') {
			// Dereference assignment: *p = 42
			const ptrResult = this.evaluator.eval(node.target.operand);
			if (ptrResult.error) { this.errors.push(ptrResult.error); return; }
			const addr = ptrResult.value.data ?? 0;
			if (addr === 0) { this.errors.push(`Null pointer dereference at line ${node.line}`); return; }
			const newVal = rhs.value.data ?? 0;
			this.memoryValues.set(addr, newVal);
			// Resolve heap block and emit setValue
			const ptrName = node.target.operand.type === 'identifier' ? node.target.operand.name : undefined;
			if (ptrName) {
				const heapBlockId = this.emitter.getHeapBlockId(ptrName);
				if (heapBlockId) {
					this.emitter.directSetValue(heapBlockId, String(newVal));
				}
			}
		} else if (node.target.type === 'subscript_expression') {
			// Element assignment: arr[i] = val, scores[i] = val
			const objPath = Evaluator.buildAccessPath(node.target.object);
			const idxResult = this.evaluator.eval(node.target.index);
			if (idxResult.error) {
				this.errors.push(idxResult.error);
				return;
			}
			const index = idxResult.value.data ?? 0;
			const newVal = rhs.value.data ?? 0;
			const displayVal = String(newVal);

			// Store the value so subsequent reads can find it
			const targetEval = this.evaluator.eval(node.target);
			if (targetEval.value.address) {
				this.memoryValues.set(targetEval.value.address, newVal);
			}

			// Resolve through pointers to reach the heap block, then target child by index
			const heapBlockId = this.emitter.resolvePointerPath(objPath);
			if (heapBlockId) {
				this.emitter.directSetValue(`${heapBlockId}-${index}`, displayVal);
			} else {
				// Stack array: resolve normally
				const parentId = this.emitter.resolvePathId(objPath);
				if (parentId) {
					this.emitter.directSetValue(`${parentId}-${index}`, displayVal);
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

		// Unary increment/decrement as statement: x++, --x, arr[0]++, etc.
		if (expr.type === 'unary_expression' && (expr.operator === '++' || expr.operator === '--')) {
			// Compute the new value (evaluator updates env for identifiers)
			const targetEval = this.evaluator.eval(expr.operand);
			if (targetEval.error) { this.errors.push(targetEval.error); return; }
			const oldVal = targetEval.value.data ?? this.memoryValues.get(targetEval.value.address) ?? 0;
			const step = isPointerType(targetEval.value.type) ? sizeOf(targetEval.value.type.pointsTo) : 1;
			const newVal = expr.operator === '++' ? (oldVal + step) | 0 : (oldVal - step) | 0;

			if (!sharesStep) {
				const desc = expr.operand.type === 'identifier'
					? `${expr.operand.name}${expr.operator}`
					: `${expr.operator}`;
				this.emitter.beginStep({ line: node.line }, desc);
				this.stepCount++;
			}

			if (expr.operand.type === 'identifier') {
				this.env.setVariable(expr.operand.name, newVal);
				const current = this.env.lookupVariable(expr.operand.name);
				if (current) {
					this.emitter.assignVariable(expr.operand.name, this.formatValue(current.type, current.data));
				}
			} else if (expr.operand.type === 'subscript_expression') {
				// arr[0]++
				const addr = targetEval.value.address;
				if (addr) this.memoryValues.set(addr, newVal);
				const objPath = Evaluator.buildAccessPath(expr.operand.object);
				const idxResult = this.evaluator.eval(expr.operand.index);
				const index = idxResult.value?.data ?? 0;
				const heapBlockId = this.emitter.resolvePointerPath(objPath);
				if (heapBlockId) {
					this.emitter.directSetValue(`${heapBlockId}-${index}`, String(newVal));
				} else {
					const parentId = this.emitter.resolvePathId(objPath);
					if (parentId) {
						this.emitter.directSetValue(`${parentId}-${index}`, String(newVal));
					}
				}
			} else if (expr.operand.type === 'member_expression') {
				// p->x++
				const addr = targetEval.value.address;
				if (addr) this.memoryValues.set(addr, newVal);
				const path = Evaluator.buildAccessPath(expr.operand);
				this.emitter.assignField(path, String(newVal));
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

		if (call.callee === 'printf' || call.callee === 'sprintf' || call.callee === 'puts') {
			if (!sharesStep) {
				this.emitter.beginStep({ line }, this.formatPrintfDesc(call));
				this.stepCount++;
			}
			return;
		}

		// User-defined function call as statement
		const fn = this.env.getFunction(call.callee);
		if (fn) {
			this.executeUserFunctionCall(fn, call, line, sharesStep);
			return;
		}

		// Stdlib call
		const result = this.evaluator.eval(call);
		if (result.error) this.errors.push(result.error);
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
		const freeResult = this.env.free(ptrAddr);
		if (freeResult.error) {
			this.errors.push(freeResult.error);
			return;
		}

		if (!sharesStep) {
			const argText = call.args[0].type === 'identifier' ? call.args[0].name : 'ptr';
			this.emitter.beginStep({ line }, `free(${argText}) — deallocate memory`);
			this.stepCount++;
		}

		// Find which pointer variable points to this heap block
		// Try the argument path as a pointer var name
		const varName = argPath[0];
		if (argPath.length === 1) {
			this.emitter.freeHeap(varName);
			this.emitter.assignVariable(varName, '(dangling)');
		} else {
			// For p->scores: free the heap block that scores points to
			// Try field name, then address-based lookup
			const fieldName = argPath[argPath.length - 1];
			const blockId = this.emitter.getHeapBlockId(fieldName)
				?? this.emitter.getHeapBlockIdByAddress(ptrAddr);
			if (blockId) {
				this.emitter.directFreeHeap(blockId);
			}
			// Update the pointer field to dangling
			const entryId = this.emitter.resolvePointerPath(argPath);
			if (entryId) {
				this.emitter.directSetValue(entryId, '(dangling)');
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
			this.emitter.beginStep({ line: node.line }, `return ${displayVal}`);
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

		if (taken) {
			this.executeStatement(node.consequent);
		} else if (node.alternate) {
			this.executeStatement(node.alternate);
		}
	}

	private executeFor(node: ASTNode & { type: 'for_statement' }): void {
		// For init
		const hasDecl = node.init?.type === 'declaration';

		if (node.init) {
			this.emitter.beginStep({ line: node.line }, `for: ${this.describeForInit(node.init)}`);
			this.stepCount++;

			if (hasDecl) {
				this.emitter.enterBlock('for');
			}

			this.executeStatement(node.init, true);
			if (!hasDecl) {
				this.emitter.enterBlock('for');
			}
		} else {
			this.emitter.beginStep({ line: node.line }, 'for: init');
			this.stepCount++;
			this.emitter.enterBlock('for');
		}

		// Loop iterations
		let iteration = 0;
		while (iteration < this.maxSteps) {
			if (this.stepCount >= this.maxSteps) {
				this.errors.push(`Step limit exceeded (${this.maxSteps})`);
				break;
			}

			// Check condition
			if (node.condition) {
				const condResult = this.evaluator.eval(node.condition);
				if (condResult.error) {
					this.errors.push(condResult.error);
					break;
				}

				const condVal = condResult.value.data ?? 0;

				if (condVal === 0) {
					// Exit loop
					const condText = this.describeExpr(node.condition);
					this.emitter.beginStep(
						{ line: node.line },
						`for: exit loop`,
						`${condText} → false`,
					);
					this.stepCount++;
					break;
				}

				// Condition true (sub-step)
				const condText = this.describeExpr(node.condition);
				this.emitter.beginStep(
					{ line: node.line, colStart: node.condColStart, colEnd: node.condColEnd },
					`for: check ${condText} → true`,
					`${condText} → true`,
				);
				this.emitter.markSubStep();
				this.stepCount++;
			}

			// Execute body — treat as block to handle per-iteration scoping
			this.executeStatement(node.body);

			if (this.breakFlag) {
				this.breakFlag = false;
				break;
			}
			if (this.continueFlag) {
				this.continueFlag = false;
			}
			if (this.returnFlag) break;

			// Update (sub-step)
			if (node.update) {
				const beforeVal = this.describeUpdateBefore(node.update);
				const result = this.evaluator.eval(node.update);
				if (result.error) this.errors.push(result.error);
				const afterVal = result.value.data ?? 0;

				this.emitter.beginStep(
					{ line: node.line, colStart: node.updateColStart, colEnd: node.updateColEnd },
					`for: ${beforeVal} → ${this.describeUpdateResult(node.update, afterVal)}`,
				);
				this.emitter.markSubStep();
				this.stepCount++;

				// Emit setValue for the loop variable
				if (node.update.type === 'unary_expression' && node.update.operand.type === 'identifier') {
					this.emitter.assignVariable(node.update.operand.name, String(afterVal));
				} else if (node.update.type === 'assignment' && node.update.target.type === 'identifier') {
					this.emitter.assignVariable(node.update.target.name, String(afterVal));
				}
			}

			iteration++;
		}

		// Exit block
		this.emitter.exitBlock('');
	}

	private executeWhile(node: ASTNode & { type: 'while_statement' }): void {
		let iteration = 0;
		const hasDecls = this.bodyHasDeclarations(node.body);

		if (hasDecls) {
			this.emitter.beginStep({ line: node.line }, 'Enter while loop');
			this.stepCount++;
			this.emitter.enterBlock('while');
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
				this.emitter.beginStep({ line: node.line }, 'while: condition false, exit');
				this.stepCount++;
				break;
			}

			// Execute body
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
			this.emitter.exitBlock('');
		}
	}

	private executeDoWhile(node: ASTNode & { type: 'do_while_statement' }): void {
		let iteration = 0;
		const hasDecls = this.bodyHasDeclarations(node.body);

		if (hasDecls) {
			this.emitter.beginStep({ line: node.line }, 'Enter do-while loop');
			this.stepCount++;
			this.emitter.enterBlock('do-while');
		}

		do {
			if (this.stepCount >= this.maxSteps) {
				this.errors.push(`Step limit exceeded (${this.maxSteps})`);
				break;
			}

			// Execute body
			if (node.body.type === 'compound_statement') {
				this.executeStatements(node.body.children);
			} else {
				this.executeStatement(node.body);
			}

			if (this.breakFlag) { this.breakFlag = false; break; }
			if (this.continueFlag) { this.continueFlag = false; }
			if (this.returnFlag) break;

			// Check condition
			const condResult = this.evaluator.eval(node.condition);
			if (condResult.error) {
				this.errors.push(condResult.error);
				break;
			}

			if ((condResult.value.data ?? 0) === 0) {
				this.emitter.beginStep({ line: node.line }, 'do-while: condition false, exit');
				this.stepCount++;
				break;
			}

			iteration++;
		} while (iteration < this.maxSteps);

		if (hasDecls) {
			this.emitter.exitBlock('');
		}
	}

	private executeBlock(node: ASTNode & { type: 'compound_statement' }): void {
		const hasDecls = node.children.some((c) => c.type === 'declaration');

		if (hasDecls) {
			this.emitter.beginStep({ line: node.line }, 'Enter block scope');
			this.stepCount++;
			this.env.pushScope('block');
			this.emitter.enterBlock('{ }');
		}

		this.executeStatements(node.children);

		if (hasDecls) {
			this.emitter.beginStep(
				{ line: this.findClosingLine(node) },
				'Exit block scope',
			);
			this.stepCount++;
			this.emitter.exitBlock('');
			this.env.popScope();
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
		const savedSP = this.env.saveStackPointer();

		// Push scope and declare params in environment first (to get addresses)
		this.env.pushScope(fn.name);
		const declaredParams: CValue[] = [];
		for (let i = 0; i < fn.params.length; i++) {
			const paramType = this.typeReg.resolve(fn.params[i].typeSpec);
			const v = this.env.declareVariable(fn.params[i].name, paramType, args[i]?.data ?? 0);
			declaredParams.push(v);
		}

		// Build params with addresses
		const params = fn.params.map((p, i) => {
			const paramType = this.typeReg.resolve(p.typeSpec);
			const argVal = args[i]?.data ?? 0;
			let children: ChildSpec[] | undefined;

			if (isStructType(paramType)) {
				// Copy actual field values from caller's struct for pass-by-value
				const srcAddr = args[i]?.address ?? 0;
				const initValues = new Map<string, string>();
				for (const field of paramType.fields) {
					const fieldAddr = srcAddr + field.offset;
					const val = this.memoryValues.get(fieldAddr);
					if (val !== undefined) {
						initValues.set(field.name, String(val));
					}
				}
				children = buildStructChildSpecs(paramType, initValues);

				// Also copy field values into memoryValues for the new param's address
				const destAddr = declaredParams[i].address;
				for (const field of paramType.fields) {
					const srcFieldAddr = srcAddr + field.offset;
					const destFieldAddr = destAddr + field.offset;
					const val = this.memoryValues.get(srcFieldAddr);
					if (val !== undefined) {
						this.memoryValues.set(destFieldAddr, val);
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

		// Emit call step (with column highlighting if available)
		const callColStart = this.callDeclContext?.colStart;
		const callColEnd = this.callDeclContext?.colEnd;
		this.emitter.beginStep(
			{ line, colStart: callColStart, colEnd: callColEnd },
			`Call ${fn.name}(${params.map((p) => p.name).join(', ')}) — push stack frame`,
		);
		this.stepCount++;

		this.emitter.enterFunction(fn.name, params, {
			caller: 'main()',
			file: '',
			line: fn.line,
		});

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
		this.emitter.beginStep({ line }, retDesc);
		this.stepCount++;
		this.emitter.exitFunction(fn.name);

		this.env.popScope();
		this.env.restoreStackPointer(savedSP);
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

		// Set column context for highlighting the call expression
		this.callDeclContext = {
			varName: '',
			colStart: (call as any).colStart,
			colEnd: (call as any).colEnd,
		};
		const result = this.callFunction(fn, args, line);
		this.callDeclContext = null;
		if (result.error) this.errors.push(result.error);
	}

	// === Leak detection ===

	private detectLeaks(): void {
		const blocks = this.env.getAllHeapBlocks();
		for (const [addr, block] of blocks) {
			if (block.status === 'allocated') {
				const blockId = this.emitter.getHeapBlockIdByAddress(addr);
				if (blockId) {
					this.emitter.leakHeap(blockId);
				}
			}
		}
	}

	// === Helpers ===

	private formatValue(type: CType, data: number | null): string {
		if (data === null) return '0';
		if (isPointerType(type)) {
			if (data === 0) return 'NULL';
			return formatAddress(data);
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
			const result = this.evaluator.eval(values[i]);
			if (result.error) this.errors.push(result.error);
			const val = result.value.data ?? 0;
			children[i].value = String(val);
			// Store in memoryValues so field values can be read back (e.g. for pass-by-value)
			if (baseAddress !== undefined) {
				this.memoryValues.set(baseAddress + type.fields[i].offset, val);
			}
		}
	}
}
