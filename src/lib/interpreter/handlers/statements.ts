import type { ASTNode, CType, CValue, ChildSpec } from '../types';
import type { HandlerContext } from './types';
import type { Memory } from '../memory';
import { formatAddress } from '../memory';
import { Evaluator } from '../evaluator';
import {
	primitiveType,
	pointerType,
	arrayType,
	sizeOf,
	typeToString,
	isStructType,
	isArrayType,
	isPointerType,
	isFunctionPointerType,
} from '../types-c';
import { buildStructChildSpecs, buildArrayChildSpecs } from '../stdlib';
import { parseScanfFormat } from '../format';
import { isArrayType as isArrayCType } from '../types-c';

/** Functions that read from stdin — used to detect interactive pause points in assignments/declarations. */
const INPUT_FUNCTIONS = new Set(['getchar', 'scanf', 'fgets', 'gets']);

export function executeDeclaration(ctx: HandlerContext, node: ASTNode & { type: 'declaration' }, sharesStep: boolean): void {
	const type = ctx.typeReg.resolve(node.declType);
	let value: CValue;
	let displayValue: string;
	let children: ChildSpec[] | undefined;

	if (isStructType(type)) {
		value = ctx.memory.declareVariableRuntime(node.name, type);
		displayValue = '';
		children = buildStructChildSpecs(type);

		if (node.initializer?.type === 'init_list') {
			initStructFromList(ctx, type, children, node.initializer.values, value.address);
		}
	} else if (isArrayType(type)) {
		value = ctx.memory.declareVariableRuntime(node.name, type);
		displayValue = '';

		let initValues: string[] | undefined;
		if (node.initializer?.type === 'init_list') {
			const flatValues: { val: number }[] = [];
			const flattenInitList = (list: ASTNode[]) => {
				for (const v of list) {
					if (v.type === 'init_list') {
						flattenInitList(v.values);
					} else {
						const result = ctx.evaluator.eval(v);
						if (result.error) ctx.errors.push(result.error);
						flatValues.push({ val: result.value.data ?? 0 });
					}
				}
			};
			flattenInitList(node.initializer.values);

			let leafType = type.elementType;
			while (isArrayType(leafType)) leafType = leafType.elementType;
			const leafSize = sizeOf(leafType);

			initValues = flatValues.map((fv, i) => {
				ctx.memory.writeMemory(value.address + i * leafSize, fv.val);
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
				const fnIdx = ctx.memory.getFunctionIndex(fnName);
				if (fnIdx > 0) {
					initData = fnIdx;
				}
			}
			else if (node.initializer.type === 'string_literal' && isPointerType(type)) {
				executeStringLiteralDecl(ctx, node, node.initializer, type, sharesStep);
				return;
			}
			else if (node.initializer.type === 'call_expression') {
				const callResult = evaluateCallForDecl(ctx, node, type);
				if (callResult.handled) return;
				if (callResult.needsInput) {
					// Create the step showing the declaration, then signal needsInput
					value = ctx.memory.declareVariableRuntime(node.name, type, null);
					displayValue = ctx.formatValue(type, null, false);
					if (!sharesStep) {
						const { desc, eval: evalStr } = formatDeclDescription(node.name, type, displayValue);
						ctx.memory.beginStep({ line: node.line }, desc, evalStr);
						ctx.stepCount++;
					}
					ctx.memory.emitVariableEntry(node.name, type, displayValue, value.address);
					ctx.needsInput = true;
					return;
				}
				if (callResult.value !== undefined) {
					initData = callResult.value;
					initWasFunctionCall = !!callResult.isUserFunc;
				}
				// On resume (sharesStep=true), the variable was already declared during
				// the needsInput path above. Update its value instead of re-declaring.
				if (sharesStep && initData !== null) {
					const existing = ctx.memory.lookupVariable(node.name);
					if (existing) {
						ctx.memory.setValue(node.name, initData);
						displayValue = ctx.formatValue(type, initData, true);
						const { desc, eval: evalStr } = formatDeclDescription(node.name, type, displayValue);
						ctx.memory.updateStepDescription(desc, evalStr);
						return;
					}
				}
			} else {
				const result = ctx.evaluator.eval(node.initializer);
				if (result.error) ctx.errors.push(result.error);
				const decayed = isPointerType(type)
					? Evaluator.decayArrayToPointer(result.value)
					: result.value;
				initData = decayed.data;
				if (initData === null || initData === undefined) initData = 0;
			}
		}
		value = ctx.memory.declareVariableRuntime(node.name, type, initData);
		displayValue = ctx.formatValue(type, initData, initData !== null);

		if (initWasFunctionCall) {
			sharesStep = true;
		}
	}

	if (!sharesStep) {
		const { desc, eval: evalStr } = formatDeclDescription(node.name, type, displayValue!);
		ctx.memory.beginStep(
			{ line: node.line },
			desc,
			evalStr,
		);
		ctx.stepCount++;
	}

	if (children) {
		ctx.memory.emitVariableEntry(node.name, type, displayValue!, value!.address, children);
	} else {
		ctx.memory.emitVariableEntry(node.name, type, displayValue!, value!.address);
	}
}

export function evaluateCallForDecl(
	ctx: HandlerContext,
	node: ASTNode & { type: 'declaration' },
	declType: CType,
): { handled: boolean; value?: number | null; isUserFunc?: boolean; needsInput?: boolean } {
	if (node.initializer?.type !== 'call_expression') return { handled: false };
	const call = node.initializer;

	if (call.callee === 'malloc' || call.callee === 'calloc') {
		const handled = executeMallocDecl(ctx, node, call, declType);
		return { handled };
	}

	// Intercept input functions for interactive mode
	if (ctx.interactive && INPUT_FUNCTIONS.has(call.callee) && ctx.io.isExhausted() && !ctx.io.isEofSignaled()) {
		return { handled: false, needsInput: true };
	}

	const isUserFunc = !!ctx.memory.getFunction(call.callee);
	ctx.callContext = { varName: node.name };
	const result = ctx.evaluator.eval(call);
	ctx.callContext = null;
	if (result.error) ctx.errors.push(result.error);
	return { handled: false, value: result.value.data, isUserFunc };
}

export function executeMallocDecl(
	ctx: HandlerContext,
	decl: ASTNode & { type: 'declaration' },
	call: ASTNode & { type: 'call_expression' },
	declType: CType,
): boolean {
	const args = call.args.map((a) => {
		const r = ctx.evaluator.eval(a);
		if (r.error) ctx.errors.push(r.error);
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

	const { address, error } = ctx.memory.mallocRuntime(totalSize, allocator, decl.line);
	if (error) {
		ctx.errors.push(error);
		return true;
	}

	ctx.memory.setHeapBlockType(address, heapType);

	const ptrValue = ctx.memory.declareVariableRuntime(decl.name, declType, address);

	let heapChildren: ChildSpec[] | undefined;
	if (isStructType(heapType)) {
		heapChildren = buildStructChildSpecs(heapType);
	} else if (isArrayType(heapType)) {
		heapChildren = buildArrayChildSpecs(heapType.elementType, heapType.size);
	}

	const desc = `Allocate ${totalSize} bytes with ${allocator}`;

	ctx.memory.beginStep({ line: decl.line }, desc, `→ ${decl.name} = ${formatAddress(address)}`);
	ctx.stepCount++;

	ctx.memory.emitHeapEntry(
		decl.name,
		heapType,
		totalSize,
		allocator,
		decl.line,
		address,
		heapChildren,
	);

	ctx.memory.emitVariableEntry(
		decl.name,
		declType,
		formatAddress(address),
		ptrValue.address,
	);

	return true;
}

export function executeStringLiteralDecl(
	ctx: HandlerContext,
	decl: ASTNode & { type: 'declaration' },
	literal: ASTNode & { type: 'string_literal' },
	declType: CType,
	sharesStep: boolean,
): void {
	const str = literal.value;
	const size = str.length + 1;

	const { address, error } = ctx.memory.mallocRuntime(size, 'string_literal', decl.line);
	if (error) {
		ctx.errors.push(error);
		return;
	}

	const heapType = arrayType(primitiveType('char'), size);
	ctx.memory.setHeapBlockType(address, heapType);

	for (let i = 0; i < str.length; i++) {
		ctx.memory.writeMemory(address + i, str.charCodeAt(i));
	}
	ctx.memory.writeMemory(address + str.length, 0);

	const ptrValue = ctx.memory.declareVariableRuntime(decl.name, declType, address);

	const charValues = str.split('').map((c) => {
		const code = c.charCodeAt(0);
		return code >= 32 && code <= 126 ? `'${c}'` : String(code);
	});
	charValues.push(`'\\0'`);
	const heapChildren = buildArrayChildSpecs(primitiveType('char'), size, charValues);

	if (!sharesStep) {
		ctx.memory.beginStep({ line: decl.line }, `Declare char *${decl.name}`, `= "${str}"`);
		ctx.stepCount++;
	}

	ctx.memory.emitHeapEntry(
		decl.name,
		heapType,
		size,
		'string_literal',
		decl.line,
		address,
		heapChildren,
	);

	ctx.memory.emitVariableEntry(
		decl.name,
		declType,
		formatAddress(address),
		ptrValue.address,
	);
}

export function executeMallocAssign(
	ctx: HandlerContext,
	node: ASTNode & { type: 'assignment' },
	call: ASTNode & { type: 'call_expression' },
	sharesStep: boolean,
): void {
	const args = call.args.map((a) => {
		const r = ctx.evaluator.eval(a);
		if (r.error) ctx.errors.push(r.error);
		return r.value;
	});

	let targetType: CType | undefined;
	if (node.target.type === 'identifier') {
		const existing = ctx.memory.lookupVariable(node.target.name);
		if (!existing) {
			ctx.errors.push(`Undefined variable '${node.target.name}' at line ${node.line}`);
			return;
		}
		targetType = existing.type;
	} else if (node.target.type === 'member_expression') {
		const targetEval = ctx.evaluator.eval(node.target);
		if (targetEval.error) { ctx.errors.push(targetEval.error); return; }
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

	const { address, error } = ctx.memory.mallocRuntime(totalSize, allocator, node.line);
	if (error) {
		ctx.errors.push(error);
		return;
	}

	ctx.memory.setHeapBlockType(address, heapType);

	let heapChildren: ChildSpec[] | undefined;
	if (isStructType(heapType)) {
		heapChildren = buildStructChildSpecs(heapType);
	} else if (isArrayType(heapType)) {
		heapChildren = buildArrayChildSpecs(heapType.elementType, heapType.size);
	}

	if (!sharesStep) {
		const targetName = node.target.type === 'identifier' ? node.target.name : ctx.describeExpr(node.target);
		ctx.memory.beginStep(
			{ line: node.line },
			`Allocate ${totalSize} bytes with ${allocator}`,
			`→ ${targetName} = ${formatAddress(address)}`,
		);
		ctx.stepCount++;
	}

	if (node.target.type === 'identifier') {
		const varName = node.target.name;
		ctx.memory.setVariable(varName, address);
		ctx.memory.emitHeapEntry(
			varName, heapType, totalSize, allocator,
			node.line, address, heapChildren,
		);
		ctx.memory.assignVariable(varName, formatAddress(address));
	} else if (node.target.type === 'member_expression') {
		const path = Evaluator.buildAccessPath(node.target);
		const fieldName = path[path.length - 1];

		const targetEval = ctx.evaluator.eval(node.target);
		if (targetEval.value.address) {
			ctx.memory.writeMemory(targetEval.value.address, address);
		}

		ctx.memory.emitHeapEntry(
			fieldName, heapType, totalSize, allocator,
			node.line, address, heapChildren,
		);

		const entryId = ctx.memory.resolvePointerPath(path);
		if (entryId) {
			ctx.memory.assignField(path, formatAddress(address));
		}
	}
}

export function executeAssignment(ctx: HandlerContext, node: ASTNode & { type: 'assignment' }, sharesStep: boolean): void {
	// Intercept malloc/calloc in assignment RHS
	if (node.operator === '=' && node.value?.type === 'call_expression') {
		const call = node.value;
		if ((call.callee === 'malloc' || call.callee === 'calloc') &&
			(node.target?.type === 'identifier' || node.target?.type === 'member_expression')) {
			executeMallocAssign(ctx, node, call, sharesStep);
			return;
		}
	}

	// Intercept input functions (getchar, etc.) in assignment RHS for interactive mode
	if (ctx.interactive && node.operator === '=' && node.value?.type === 'call_expression') {
		const call = node.value;
		if (INPUT_FUNCTIONS.has(call.callee) && ctx.io.isExhausted() && !ctx.io.isEofSignaled()) {
			if (!sharesStep) {
				ctx.memory.beginStep({ line: node.line }, formatAssignDesc(ctx, node));
				ctx.stepCount++;
			}
			ctx.needsInput = true;
			return;
		}
	}

	// Chained assignment
	if (node.operator === '=' && node.value?.type === 'assignment') {
		if (!sharesStep) {
			ctx.memory.beginStep({ line: node.line }, formatAssignDesc(ctx, node));
			ctx.stepCount++;
			sharesStep = true;
		}
		executeAssignment(ctx, node.value, true);
	}

	// Function pointer assignment
	if (node.operator === '=' && node.value?.type === 'identifier' && node.target?.type === 'identifier') {
		const targetVar = ctx.memory.lookupVariable(node.target.name);
		if (targetVar && isFunctionPointerType(targetVar.type)) {
			const fnIdx = ctx.memory.getFunctionIndex(node.value.name);
			if (fnIdx > 0) {
				if (!sharesStep) {
					ctx.memory.beginStep({ line: node.line }, formatAssignDesc(ctx, node));
					ctx.stepCount++;
				}
				ctx.memory.setVariable(node.target.name, fnIdx);
				const target = ctx.memory.getFunctionByIndex(fnIdx);
				ctx.memory.assignVariable(node.target.name, target ? `→ ${target.name}` : String(fnIdx));
				return;
			}
		}
	}

	const rhs = ctx.evaluator.eval(node.value);
	if (rhs.error) {
		ctx.errors.push(rhs.error);
		return;
	}

	if (node.target.type === 'identifier') {
		const existing = ctx.memory.lookupVariable(node.target.name);
		if (!existing) {
			ctx.errors.push(`Undefined variable '${node.target.name}' at line ${node.line}`);
			return;
		}

		let newVal = rhs.value.data ?? 0;
		const oldVal = existing.data ?? 0;
		newVal = applyCompoundOp(node.operator, oldVal, newVal);

		if (!sharesStep) {
			const evalStr = assignNeedsEval(node, rhs.value.data ?? 0, newVal)
				? `→ ${ctx.formatValue(existing.type, newVal)}`
				: undefined;
			ctx.memory.beginStep({ line: node.line }, formatAssignDesc(ctx, node), evalStr);
			ctx.stepCount++;
		}

		ctx.memory.setVariable(node.target.name, newVal);

		const displayVal = ctx.formatValue(existing.type, newVal);
		ctx.memory.assignVariable(node.target.name, displayVal);
	} else if (node.target.type === 'member_expression') {
		const path = Evaluator.buildAccessPath(node.target);
		let newVal = rhs.value.data ?? 0;

		if (node.operator !== '=') {
			const targetEval = ctx.evaluator.eval(node.target);
			const oldVal = targetEval.value.data ?? ctx.memory.readMemory(targetEval.value.address) ?? 0;
			newVal = applyCompoundOp(node.operator, oldVal, newVal);
		}

		if (!sharesStep) {
			const evalStr = assignNeedsEval(node, rhs.value.data ?? 0, newVal)
				? `→ ${newVal}`
				: undefined;
			ctx.memory.beginStep({ line: node.line }, formatAssignDesc(ctx, node), evalStr);
			ctx.stepCount++;
		}

		const displayVal = String(newVal);

		const targetEval = ctx.evaluator.eval(node.target);
		if (targetEval.value.address) {
			ctx.memory.writeMemory(targetEval.value.address, newVal);
		}

		const entryId = ctx.memory.resolvePointerPath(path);
		if (entryId) {
			ctx.memory.setValueById(entryId, displayVal);
		}
	} else if (node.target.type === 'unary_expression' && node.target.operator === '*') {
		const ptrResult = ctx.evaluator.eval(node.target.operand);
		if (ptrResult.error) { ctx.errors.push(ptrResult.error); return; }
		const addr = ptrResult.value.data ?? 0;
		if (addr === 0) { ctx.errors.push(`Null pointer dereference at line ${node.line}`); return; }
		if (ctx.memory.isFreedAddress(addr)) { ctx.errors.push(`Use-after-free: writing to freed memory at ${formatAddress(addr)}`); return; }
		if (!sharesStep) {
			ctx.memory.beginStep({ line: node.line }, formatAssignDesc(ctx, node));
			ctx.stepCount++;
		}
		const newVal = rhs.value.data ?? 0;
		ctx.memory.writeMemory(addr, newVal);
		const ptrName = node.target.operand.type === 'identifier' ? node.target.operand.name : undefined;
		if (ptrName) {
			const heapBlockId = ctx.memory.getHeapBlockId(ptrName);
			if (heapBlockId) {
				ctx.memory.setValueById(heapBlockId, String(newVal));
			}
		}
	} else if (node.target.type === 'subscript_expression') {
		if (!sharesStep) {
			ctx.memory.beginStep({ line: node.line }, formatAssignDesc(ctx, node));
			ctx.stepCount++;
		}
		// Nested subscript: m[i][j] = val (2D array)
		if (node.target.object.type === 'subscript_expression') {
			const innerSub = node.target;
			const outerSub = innerSub.object as ASTNode & { type: 'subscript_expression' };

			const outerIdxResult = ctx.evaluator.eval(outerSub.index);
			const innerIdxResult = ctx.evaluator.eval(innerSub.index);
			if (outerIdxResult.error || innerIdxResult.error) {
				ctx.errors.push(outerIdxResult.error ?? innerIdxResult.error ?? 'Index error');
				return;
			}

			const outerIdx = outerIdxResult.value.data ?? 0;
			const innerIdx = innerIdxResult.value.data ?? 0;

			const rootName = outerSub.object.type === 'identifier' ? outerSub.object.name : '';
			const rootVar = rootName ? ctx.memory.lookupVariable(rootName) : undefined;

			let innerDim = 1;
			if (rootVar && isArrayType(rootVar.type) && isArrayType(rootVar.type.elementType)) {
				const outerSize = rootVar.type.size;
				innerDim = rootVar.type.elementType.size;

				if (outerIdx < 0 || outerIdx >= outerSize) {
					ctx.errors.push(`Array index ${outerIdx} out of bounds (size ${outerSize}) at line ${node.line}`);
					return;
				}
				if (innerIdx < 0 || innerIdx >= innerDim) {
					ctx.errors.push(`Array index ${innerIdx} out of bounds (size ${innerDim}) at line ${node.line}`);
					return;
				}
			}

			const flatIdx = outerIdx * innerDim + innerIdx;
			const newVal = rhs.value.data ?? 0;
			const displayVal = String(newVal);

			const targetEval = ctx.evaluator.eval(node.target);
			if (targetEval.value.address) {
				ctx.memory.writeMemory(targetEval.value.address, newVal);
			}

			const rootId = ctx.memory.resolvePathId([rootName]);
			if (rootId) {
				ctx.memory.setValueById(`${rootId}-${flatIdx}`, displayVal);
			}
			return;
		}

		// Single subscript: arr[i] = val
		const objPath = Evaluator.buildAccessPath(node.target.object);
		const idxResult = ctx.evaluator.eval(node.target.index);
		if (idxResult.error) {
			ctx.errors.push(idxResult.error);
			return;
		}
		const index = idxResult.value.data ?? 0;

		const objResult = ctx.evaluator.eval(node.target.object);
		if (!objResult.error && isPointerType(objResult.value.type)) {
			const heapAddr = objResult.value.data ?? 0;
			if (ctx.memory.isFreedAddress(heapAddr)) {
				ctx.errors.push(`Use-after-free: writing to freed memory at ${formatAddress(heapAddr)}`);
				return;
			}
		}

		if (!objResult.error) {
			if (isPointerType(objResult.value.type)) {
				const heapAddr = objResult.value.data ?? 0;
				const block = ctx.memory.getHeapBlock(heapAddr);
				if (block && isArrayType(block.type) && (index < 0 || index >= block.type.size)) {
					ctx.errors.push(`Heap buffer overflow: index ${index} out of bounds (size ${block.type.size}) at line ${node.line}`);
					return;
				}
			} else if (isArrayType(objResult.value.type)) {
				if (index < 0 || index >= objResult.value.type.size) {
					ctx.errors.push(`Array index ${index} out of bounds (size ${objResult.value.type.size}) at line ${node.line}`);
					return;
				}
			}
		}

		const newVal = rhs.value.data ?? 0;
		const displayVal = String(newVal);

		const targetEval = ctx.evaluator.eval(node.target);
		if (targetEval.value.address) {
			ctx.memory.writeMemory(targetEval.value.address, newVal);
		}

		const heapBlockId = ctx.memory.resolvePointerPath(objPath);
		if (heapBlockId) {
			ctx.memory.setValueById(`${heapBlockId}-${index}`, displayVal);
		} else {
			const parentId = ctx.memory.resolvePathId(objPath);
			if (parentId) {
				ctx.memory.setValueById(`${parentId}-${index}`, displayVal);
			}
		}
	}
}

export function* executeExpressionStatement(ctx: HandlerContext, node: ASTNode & { type: 'expression_statement' }, sharesStep: boolean): Generator<void, void, void> {
	const expr = node.expression;

	if (expr.type === 'call_expression') {
		yield* executeCallStatement(ctx, expr, node.line, sharesStep);
		return;
	}

	if (expr.type === 'assignment') {
		executeAssignment(ctx, { ...expr, line: node.line } as any, sharesStep);
		return;
	}

	// Unary increment/decrement as statement
	if (expr.type === 'unary_expression' && (expr.operator === '++' || expr.operator === '--')) {
		const targetEval = ctx.evaluator.eval(expr.operand);
		if (targetEval.error) { ctx.errors.push(targetEval.error); return; }
		const oldVal = targetEval.value.data ?? ctx.memory.readMemory(targetEval.value.address) ?? 0;
		const step = isPointerType(targetEval.value.type) ? sizeOf(targetEval.value.type.pointsTo) : 1;
		const newVal = expr.operator === '++' ? (oldVal + step) | 0 : (oldVal - step) | 0;

		if (!sharesStep) {
			const name = expr.operand.type === 'identifier' ? expr.operand.name : '';
			const desc = name
				? (expr.prefix ? `${expr.operator}${name}` : `${name}${expr.operator}`)
				: `${expr.operator}`;
			const evalStr = name ? `→ ${name} = ${newVal}` : `→ ${newVal}`;
			ctx.memory.beginStep({ line: node.line }, desc, evalStr);
			ctx.stepCount++;
		}

		if (expr.operand.type === 'identifier') {
			ctx.memory.setVariable(expr.operand.name, newVal);
			const current = ctx.memory.lookupVariable(expr.operand.name);
			if (current) {
				ctx.memory.assignVariable(expr.operand.name, ctx.formatValue(current.type, current.data));
			}
		} else if (expr.operand.type === 'subscript_expression') {
			const addr = targetEval.value.address;
			if (addr) ctx.memory.writeMemory(addr, newVal);
			const objPath = Evaluator.buildAccessPath(expr.operand.object);
			const idxResult = ctx.evaluator.eval(expr.operand.index);
			const index = idxResult.value?.data ?? 0;
			const heapBlockId = ctx.memory.resolvePointerPath(objPath);
			if (heapBlockId) {
				ctx.memory.setValueById(`${heapBlockId}-${index}`, String(newVal));
			} else {
				const parentId = ctx.memory.resolvePathId(objPath);
				if (parentId) {
					ctx.memory.setValueById(`${parentId}-${index}`, String(newVal));
				}
			}
		} else if (expr.operand.type === 'member_expression') {
			const addr = targetEval.value.address;
			if (addr) ctx.memory.writeMemory(addr, newVal);
			const path = Evaluator.buildAccessPath(expr.operand);
			ctx.memory.assignField(path, String(newVal));
		}
		return;
	}

	// Evaluate for side effects
	const result = ctx.evaluator.eval(expr);
	if (result.error) ctx.errors.push(result.error);
}

export function* executeCallStatement(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }, line: number, sharesStep: boolean): Generator<void, void, void> {
	if (call.callee === 'free') {
		executeFreeCall(ctx, call, line, sharesStep);
		return;
	}

	// sprintf/snprintf: format string and write bytes to destination buffer
	if ((call.callee === 'sprintf' || call.callee === 'snprintf') && call.args.length >= 2) {
		const isSnprintf = call.callee === 'snprintf';
		const fmtArgIdx = isSnprintf ? 2 : 1;
		const destResult = ctx.evaluator.eval(call.args[0]);
		const formatted = evaluateSprintfResult(ctx, call, fmtArgIdx);

		let maxLen: number | undefined;
		if (isSnprintf && call.args.length >= 2) {
			const sizeResult = ctx.evaluator.eval(call.args[1]);
			maxLen = sizeResult.value?.data ?? 0;
			if (maxLen <= 0) {
				// snprintf(buf, 0, ...) writes nothing
				if (!sharesStep) {
					ctx.memory.beginStep({ line }, `snprintf(${ctx.describeExpr(call.args[0])}, ${maxLen}, ...)`, `→ "${formatted}" (not written)`);
					ctx.stepCount++;
				}
				return;
			}
		}

		if (!sharesStep) {
			ctx.memory.beginStep({ line }, `${call.callee}(${ctx.describeExpr(call.args[0])}, ...)`, `→ "${formatted}"`);
			ctx.stepCount++;
		}

		const destName = call.args[0].type === 'identifier' ? call.args[0].name : undefined;
		if (destName) {
			// Write bytes to children (for individual char display)
			writeStringToBuffer(ctx, destName, formatted, maxLen);

			// Also set quoted string on the parent entry (for summary display)
			const blockId = ctx.memory.getHeapBlockId(destName);
			if (blockId) {
				ctx.memory.setValueById(blockId, `"${formatted}"`);
			} else {
				const varId = ctx.memory.getVarEntryId(destName);
				if (varId) {
					ctx.memory.setValueById(varId, `"${formatted}"`);
				}
			}
		}
		return;
	}

	// I/O output functions: create a step and evaluate through stdlib (triggers IoState)
	if (isStdioOutputFunction(call.callee)) {
		if (!sharesStep) {
			ctx.memory.beginStep({ line }, formatPrintfDesc(ctx, call));
			ctx.stepCount++;
		}
		const stdoutBefore = ctx.io.getStdout();
		const result = ctx.evaluator.eval(call);
		if (result.error) ctx.errors.push(result.error);

		// Enrich step description with output produced
		const stdoutAfter = ctx.io.getStdout();
		if (stdoutAfter.length > stdoutBefore.length) {
			const produced = stdoutAfter.slice(stdoutBefore.length);
			const escaped = produced.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
			const desc = formatPrintfDesc(ctx, call);
			ctx.memory.updateStepDescription(desc, `→ "${escaped}"`);
		}
		return;
	}

	// scanf: consume from stdin and write through to variables
	if (call.callee === 'scanf') {
		executeScanfCall(ctx, call, line, sharesStep);
		return;
	}

	// fgets: read line from stdin into buffer
	if (call.callee === 'fgets') {
		executeFgetsCall(ctx, call, line, sharesStep);
		return;
	}

	// gets: read line from stdin (no bounds checking)
	if (call.callee === 'gets') {
		executeGetsCall(ctx, call, line, sharesStep);
		return;
	}

	// getchar: handled in stdlib via evaluator (returns int value)
	if (call.callee === 'getchar') {
		if (!sharesStep) {
			ctx.memory.beginStep({ line }, formatPrintfDesc(ctx, call));
			ctx.stepCount++;
		}
		if (ctx.io.isExhausted() && ctx.interactive && !ctx.io.isEofSignaled()) {
			ctx.needsInput = true;
			return;
		}
		const result = ctx.evaluator.eval(call);
		if (result.error) ctx.errors.push(result.error);
		return;
	}

	// User-defined function call as statement
	const fn = ctx.memory.getFunction(call.callee);
	if (fn) {
		yield* executeUserFunctionCall(ctx, fn, call, line, sharesStep);
		return;
	}

	// Function pointer call as statement
	const fpVar = ctx.memory.lookupVariable(call.callee);
	if (fpVar && isFunctionPointerType(fpVar.type)) {
		const idx = fpVar.data ?? 0;
		if (idx === 0) {
			ctx.errors.push(`Null function pointer call '${call.callee}' at line ${line}`);
			return;
		}
		const target = ctx.memory.getFunctionByIndex(idx);
		if (target) {
			yield* executeUserFunctionCall(ctx, target.node, call, line, sharesStep);
			return;
		}
		ctx.errors.push(`Invalid function pointer '${call.callee}' at line ${line}`);
		return;
	}

	// Stdlib call
	if (!sharesStep) {
		const argDescs = call.args.map(a => ctx.describeExpr(a)).join(', ');
		ctx.memory.beginStep({ line }, `${call.callee}(${argDescs})`);
		ctx.stepCount++;
	}
	const result = ctx.evaluator.eval(call);
	if (result.error) ctx.errors.push(result.error);

	if (call.callee === 'strcpy' || call.callee === 'strcat') {
		updateHeapChildrenFromMemory(ctx, call.args[0]);
	}
}

export function executeFreeCall(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }, line: number, sharesStep: boolean): void {
	if (call.args.length === 0) return;

	const argPath = Evaluator.buildAccessPath(call.args[0]);
	const result = ctx.evaluator.eval(call.args[0]);
	if (result.error) {
		ctx.errors.push(result.error);
		return;
	}

	const ptrAddr = result.value.data ?? 0;
	const freeResult = ctx.memory.freeByAddress(ptrAddr);
	if (freeResult.error) {
		ctx.errors.push(freeResult.error);
		return;
	}

	if (!sharesStep) {
		const argText = ctx.describeExpr(call.args[0]);
		ctx.memory.beginStep({ line }, `Free memory at ${argText}`);
		ctx.stepCount++;
	}

	const varName = argPath[0];
	if (argPath.length === 1) {
		// freeByAddress already marked the block freed in runtime.
		// Now emit the visualization op.
		const blockId = ctx.memory.getHeapBlockId(varName);
		if (blockId) {
			ctx.memory.freeHeapById(blockId);
		}
		ctx.memory.assignVariable(varName, '(dangling)');
	} else {
		const fieldName = argPath[argPath.length - 1];
		const blockId = ctx.memory.getHeapBlockId(fieldName)
			?? ctx.memory.getHeapBlockIdByAddress(ptrAddr);
		if (blockId) {
			ctx.memory.freeHeapById(blockId);
		}
		const entryId = ctx.memory.resolvePointerPath(argPath);
		if (entryId) {
			ctx.memory.setValueById(entryId, '(dangling)');
		}
	}
}

export function executeReturn(ctx: HandlerContext, node: ASTNode & { type: 'return_statement' }, sharesStep: boolean): void {
	let value: CValue | null = null;
	let displayVal = '0';

	if (node.value) {
		const result = ctx.evaluator.eval(node.value);
		if (result.error) ctx.errors.push(result.error);
		value = result.value;
		displayVal = String(value.data ?? 0);
	}

	if (!sharesStep) {
		ctx.memory.beginStep({ line: node.line }, `return ${displayVal}`);
		ctx.stepCount++;
	}

	ctx.returnFlag = true;
	ctx.returnValue = value;
}

export function formatDeclDescription(name: string, type: CType, value: string): { desc: string; eval?: string } {
	const typeStr = typeToString(type);
	const desc = `Declare ${typeStr} ${name}`;
	if (isStructType(type)) {
		return { desc, eval: `= {...}` };
	}
	if (isArrayType(type)) {
		return { desc, eval: `= {...}` };
	}
	return { desc, eval: `= ${value}` };
}

export function formatAssignDesc(ctx: HandlerContext, node: ASTNode & { type: 'assignment' }): string {
	const target = ctx.describeExpr(node.target);
	const value = ctx.describeExpr(node.value);

	if (node.operator === '=') {
		return `Set ${target} = ${value}`;
	}
	return `Set ${target} ${node.operator} ${value}`;
}

export function formatMallocArgs(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }): string {
	return call.args.map((a) => ctx.describeExpr(a)).join(', ');
}

export function formatPrintfDesc(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }): string {
	const args = call.args.map((a) => ctx.describeExpr(a)).join(', ');
	return `${call.callee}(${args})`;
}

const STDIO_OUTPUT_FUNCTIONS = new Set([
	'printf', 'fprintf', 'puts', 'putchar', 'fputs',
]);

const STDIO_INPUT_FUNCTIONS = new Set([
	'scanf', 'getchar', 'fgets', 'gets',
]);

export function isStdioOutputFunction(name: string): boolean {
	return STDIO_OUTPUT_FUNCTIONS.has(name);
}

export function isStdioInputFunction(name: string): boolean {
	return STDIO_INPUT_FUNCTIONS.has(name);
}

export function isStdioFunction(name: string): boolean {
	return STDIO_OUTPUT_FUNCTIONS.has(name) || STDIO_INPUT_FUNCTIONS.has(name);
}

// === scanf/fgets/gets statement-level handlers ===

/**
 * Extract the target variable name from a scanf pointer argument.
 * Expects `&identifier` → returns identifier name.
 * Returns null if the argument is not `&identifier`.
 */
function extractScanfTargetVar(arg: ASTNode): { name: string; hasAddressOf: boolean } | null {
	if (arg.type === 'unary_expression' && arg.operator === '&' && arg.operand.type === 'identifier') {
		return { name: arg.operand.name, hasAddressOf: true };
	}
	// Accept bare identifiers — arrays decay to pointers in scanf calls (e.g., scanf("%s", s))
	if (arg.type === 'identifier') {
		return { name: arg.name, hasAddressOf: false };
	}
	return null;
}

function executeScanfCall(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }, line: number, sharesStep: boolean): void {
	if (call.args.length < 1) {
		ctx.errors.push('scanf: requires at least one argument');
		return;
	}

	// Extract format string from AST
	const fmtArg = call.args[0];
	if (fmtArg.type !== 'string_literal') {
		// Non-literal format string: can't parse at interpretation time
		if (!sharesStep) {
			ctx.memory.beginStep({ line }, formatPrintfDesc(ctx, call));
			ctx.stepCount++;
		}
		return;
	}
	const fmtStr = (fmtArg as ASTNode & { type: 'string_literal' }).value;
	const tokens = parseScanfFormat(fmtStr);

	if (!sharesStep) {
		ctx.memory.beginStep({ line }, formatPrintfDesc(ctx, call));
		ctx.stepCount++;
	}

	// Check for EOF / need input
	if (ctx.io.isExhausted()) {
		if (ctx.interactive && !ctx.io.isEofSignaled()) {
			ctx.needsInput = true;
		}
		return;
	}

	let itemsAssigned = 0;
	let argIdx = 1; // pointer args start at index 1
	const assignments: string[] = [];

	for (const token of tokens) {
		if (token.kind === 'whitespace') {
			// Whitespace in format = skip whitespace in input (IoState handles this in readInt etc.)
			continue;
		}
		if (token.kind === 'literal') {
			// Literal match: consume the literal char from stdin (simplified — skip for v1)
			continue;
		}
		// Specifier token
		const spec = token;

		// Read value from stdin based on specifier
		let readResult: { value: number; consumed: string } | null = null;
		switch (spec.specifier) {
			case 'd':
			case 'i':
				readResult = ctx.io.readInt();
				break;
			case 'f':
				readResult = ctx.io.readFloat();
				break;
			case 'c':
				readResult = ctx.io.readChar();
				break;
			case 's': {
				const strResult = ctx.io.readString();
				if (strResult) {
					// For %s, we'd write to a char array — simplified for v1
					// Just consume the input and note it in the description
					readResult = { value: 0, consumed: strResult.consumed };
				}
				break;
			}
			case 'x':
			case 'X':
				readResult = ctx.io.readHexInt();
				break;
			default:
				// Unsupported specifier — skip
				continue;
		}

		if (!readResult) {
			// Read failed — in interactive mode, pause for more input
			// (readInt/readFloat reset position on failure, so isExhausted() may be false
			//  even though the remaining content is just unconsumed whitespace)
			if (ctx.interactive && !ctx.io.isEofSignaled()) {
				ctx.needsInput = true;
			}
			break;
		}

		if (spec.suppress) {
			// %* — consume but don't assign, don't count
			continue;
		}

		// Write through to target variable
		if (argIdx < call.args.length) {
			const targetArg = call.args[argIdx];
			const target = extractScanfTargetVar(targetArg);

			if (target === null) {
				ctx.errors.push(`scanf: argument ${argIdx} must be a pointer (missing &?)`);
			} else if (!target.hasAddressOf) {
				// Bare identifier without & — only valid for array types (arrays decay to pointers)
				const v = ctx.memory.lookupVariable(target.name);
				if (v && isArrayCType(v.type)) {
					ctx.memory.setValue(target.name, readResult.value);
				} else {
					ctx.errors.push(`scanf: argument ${argIdx} must be a pointer (missing &?)`);
				}
			} else {
				ctx.memory.setValue(target.name, readResult.value);
				// Track for description enrichment
				if (spec.specifier === 'c') {
					const charRepr = readResult.value === 10 ? "'\\n'" : readResult.value === 9 ? "'\\t'" : `'${String.fromCharCode(readResult.value)}'`;
					assignments.push(`${target.name} = ${charRepr} (${readResult.value})`);
				} else {
					assignments.push(`${target.name} = ${readResult.value}`);
				}
			}
			argIdx++;
		}
		itemsAssigned++;
	}

	// Enrich step description with read results
	if (assignments.length > 0) {
		const desc = formatPrintfDesc(ctx, call);
		ctx.memory.updateStepDescription(desc, `→ ${assignments.join(', ')}`);
	} else if (ctx.io.isExhausted()) {
		const desc = formatPrintfDesc(ctx, call);
		ctx.memory.updateStepDescription(desc, '→ EOF');
	}
}

function executeFgetsCall(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }, line: number, sharesStep: boolean): void {
	if (!sharesStep) {
		ctx.memory.beginStep({ line }, formatPrintfDesc(ctx, call));
		ctx.stepCount++;
	}

	if (call.args.length < 2) {
		ctx.errors.push('fgets: requires at least 2 arguments');
		return;
	}

	// Check for empty stdin
	if (ctx.io.isExhausted()) {
		if (ctx.interactive && !ctx.io.isEofSignaled()) ctx.needsInput = true;
		return;
	}

	// Evaluate size argument
	const sizeResult = ctx.evaluator.eval(call.args[1]);
	const maxLen = sizeResult.value?.data ?? 256;

	// Read from stdin
	const result = ctx.io.readLine(maxLen);
	if (!result) return; // EOF

	// Write to destination buffer (simplified: show as quoted string on heap entry)
	const destArg = call.args[0];
	if (destArg.type === 'identifier') {
		const blockId = ctx.memory.getHeapBlockId(destArg.name);
		if (blockId) {
			ctx.memory.setValueById(blockId, `"${result.value}"`);
		}
	}
}

function executeGetsCall(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }, line: number, sharesStep: boolean): void {
	if (call.args.length < 1) {
		ctx.errors.push('gets: requires at least 1 argument');
		return;
	}

	if (!sharesStep) {
		ctx.memory.beginStep({ line }, formatPrintfDesc(ctx, call));
		ctx.stepCount++;
	}

	// Check for empty stdin
	if (ctx.io.isExhausted()) {
		if (ctx.interactive && !ctx.io.isEofSignaled()) ctx.needsInput = true;
		return;
	}

	// Read from stdin (unbounded)
	const result = ctx.io.readUntilNewline();

	if (!result) {
		ctx.memory.updateStepDescription(formatPrintfDesc(ctx, call), '→ EOF');
		return;
	}

	// Write to destination buffer using writeStringToBuffer with overflow enabled
	const destArg = call.args[0];
	if (destArg.type === 'identifier') {
		const writeResult = writeStringToBuffer(ctx, destArg.name, result.value, undefined, true);

		// Enrich description
		let evalText = `→ read "${result.value}" (${result.value.length} bytes)`;
		if (writeResult.overflowVars.length > 0) {
			evalText += ` — overflow! clobbered ${writeResult.overflowVars.join(', ')}`;
		}
		ctx.memory.updateStepDescription(`gets(${ctx.describeExpr(call.args[0])})`, evalText);

		// Also set parent entry for summary display
		const blockId = ctx.memory.getHeapBlockId(destArg.name);
		if (blockId) {
			ctx.memory.setValueById(blockId, `"${result.value}"`);
		} else {
			const varId = ctx.memory.getVarEntryId(destArg.name);
			if (varId) {
				ctx.memory.setValueById(varId, `"${result.value}"`);
			}
		}
	}
}

/** Returns true when the assignment result isn't obvious from the description alone. */
export function assignNeedsEval(node: ASTNode & { type: 'assignment' }, rhsData: number, finalVal: number): boolean {
	// Compound operators always need eval — result isn't obvious
	if (node.operator !== '=') return true;
	// If RHS is a simple literal or identifier, the description says it all
	if (node.value.type === 'number_literal') return false;
	if (node.value.type === 'identifier') return false;
	if (node.value.type === 'null_literal') return false;
	if (node.value.type === 'string_literal') return false;
	// Expression — show the computed result
	return true;
}

export function applyCompoundOp(op: string, oldVal: number, newVal: number): number {
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

export function evaluateSprintfResult(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }, fmtArgIdx = 1): string {
	if (call.args.length <= fmtArgIdx) return '';
	const fmtResult = ctx.evaluator.eval(call.args[fmtArgIdx]);
	let fmt = '';
	if (call.args[fmtArgIdx].type === 'string_literal') {
		fmt = (call.args[fmtArgIdx] as any).value ?? '';
	} else {
		return '';
	}

	let argIdx = fmtArgIdx + 1;
	let result = '';
	for (let i = 0; i < fmt.length; i++) {
		if (fmt[i] === '%' && i + 1 < fmt.length) {
			i++;
			if (fmt[i] === '%') {
				result += '%';
			} else if (argIdx < call.args.length) {
				const argResult = ctx.evaluator.eval(call.args[argIdx]);
				const val = argResult.value?.data ?? 0;
				switch (fmt[i]) {
					case 'd': case 'i': result += String(val); break;
					case 's': {
						// Resolve string from stringValue or memory
						const strVal = argResult.value?.stringValue;
						if (strVal !== undefined) {
							result += strVal;
						} else if (val !== 0) {
							// Read from memory address
							let str = '';
							for (let j = 0; j < 10000; j++) {
								const byte = ctx.memory.readMemory(val + j);
								if (byte === undefined || byte === 0) break;
								str += String.fromCharCode(byte);
							}
							result += str;
						} else {
							result += '(null)';
						}
						break;
					}
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

/**
 * Write a string byte-by-byte into a buffer (stack array or heap block).
 * Emits setValue ops for each child entry AND writes to addressValues for runtime consistency.
 */
export function writeStringToBuffer(
	ctx: HandlerContext,
	destName: string,
	str: string,
	maxLen?: number,
	allowOverflow?: boolean,
): { bytesWritten: number; overflowVars: string[] } {
	const cvalue = ctx.memory.lookupVariable(destName);
	if (!cvalue) return { bytesWritten: 0, overflowVars: [] };

	// Determine base address, array size, and entry ID
	let baseAddr: number;
	let arraySize = 256; // default limit
	let entryId: string | undefined;

	if (isArrayCType(cvalue.type)) {
		// Stack array: address is the array's base address
		baseAddr = cvalue.address;
		arraySize = cvalue.type.size;
		entryId = ctx.memory.getVarEntryId(destName);
	} else {
		// Pointer to heap block: data is the heap address
		baseAddr = cvalue.data ?? 0;
		if (baseAddr === 0) return { bytesWritten: 0, overflowVars: [] };
		const heapId = ctx.memory.getHeapBlockId(destName);
		if (heapId) {
			entryId = heapId;
			const block = ctx.memory.getHeapBlock(baseAddr);
			if (block) arraySize = block.size;
		}
	}

	if (!entryId) return { bytesWritten: 0, overflowVars: [] };

	// Check if children exist (heap blocks may not have children if array inference didn't fire)
	const hasChildren = ctx.memory.hasChildEntries(entryId);
	if (!hasChildren) {
		// No children — write bytes to addressValues only (for strlen etc.), skip setValue ops
		const writeLen = Math.min(str.length, maxLen !== undefined ? maxLen - 1 : arraySize);
		for (let i = 0; i < writeLen; i++) {
			ctx.memory.writeMemory(baseAddr + i, str.charCodeAt(i));
		}
		ctx.memory.writeMemory(baseAddr + writeLen, 0);
		return { bytesWritten: writeLen, overflowVars: [] };
	}

	// Compute write limit (for bounded writes)
	const boundsLimit = maxLen !== undefined ? Math.min(maxLen - 1, arraySize) : arraySize;
	// For overflow: write up to str.length, capped at 256 past array end
	const maxOverflow = allowOverflow ? Math.min(str.length, arraySize + 256) : boundsLimit;
	const writeLen = Math.min(str.length, maxOverflow);
	const overflowVars: string[] = [];

	// Write each byte with setValue ops
	for (let i = 0; i < writeLen; i++) {
		const charCode = str.charCodeAt(i);
		ctx.memory.writeMemory(baseAddr + i, charCode);

		if (i < arraySize) {
			// Within bounds: update own children
			ctx.memory.setValueById(`${entryId}-${i}`, String(charCode));
		} else if (allowOverflow) {
			// Overflow: find adjacent variable at this address
			const target = ctx.memory.findEntryIdAtAddress(baseAddr + i);
			if (target) {
				if (!overflowVars.includes(target.varName)) {
					overflowVars.push(target.varName);
				}
				if (isArrayCType(cvalue.type) || target.elemSize === 1) {
					// Array child: emit setValue on the child entry
					const childIdx = Math.floor(target.offset / target.elemSize);
					ctx.memory.setValueById(`${target.entryId}-${childIdx}`, String(charCode));
				} else {
					// Scalar variable: overwrite its value
					ctx.memory.setValueById(target.entryId, String(charCode));
				}
			}
		}
	}

	// Write null terminator
	const nullPos = writeLen;
	if (nullPos < arraySize) {
		ctx.memory.writeMemory(baseAddr + nullPos, 0);
		ctx.memory.setValueById(`${entryId}-${nullPos}`, '0');
	} else if (allowOverflow) {
		ctx.memory.writeMemory(baseAddr + nullPos, 0);
	}

	return { bytesWritten: writeLen, overflowVars };
}

export function updateHeapChildrenFromMemory(ctx: HandlerContext, destArg: ASTNode): void {
	if (destArg.type !== 'identifier') return;
	const ptrVar = ctx.memory.lookupVariable(destArg.name);
	if (!ptrVar || !ptrVar.data) return;
	const baseAddr = ptrVar.data;
	const block = ctx.memory.getHeapBlock(baseAddr);
	if (!block) return;
	const blockId = ctx.memory.getHeapBlockId(destArg.name);
	if (!blockId) return;
	for (let i = 0; i < block.size; i++) {
		const val = ctx.memory.readMemory(baseAddr + i);
		if (val !== undefined) {
			ctx.memory.setValueById(`${blockId}-${i}`, String(val));
		}
	}
}

export function initStructFromList(ctx: HandlerContext, type: CType & { kind: 'struct' }, children: ChildSpec[], values: ASTNode[], baseAddress?: number): void {
	for (let i = 0; i < Math.min(type.fields.length, values.length); i++) {
		const field = type.fields[i];
		const init = values[i];
		if (isStructType(field.type) && init.type === 'init_list') {
			const nestedChildren = children[i].children;
			if (nestedChildren) {
				const nestedBase = baseAddress !== undefined ? baseAddress + field.offset : undefined;
				initStructFromList(ctx, field.type, nestedChildren, init.values, nestedBase);
			}
			continue;
		}
		const result = ctx.evaluator.eval(init);
		if (result.error) ctx.errors.push(result.error);
		const val = result.value.data ?? 0;
		children[i].value = String(val);
		if (baseAddress !== undefined) {
			ctx.memory.writeMemory(baseAddress + field.offset, val);
		}
	}
}

export function* executeUserFunctionCall(
	ctx: HandlerContext,
	fn: ASTNode & { type: 'function_definition' },
	call: ASTNode & { type: 'call_expression' },
	line: number,
	sharesStep: boolean,
): Generator<void, void, void> {
	const args = call.args.map((a) => {
		const r = ctx.evaluator.eval(a);
		if (r.error) ctx.errors.push(r.error);
		return r.value;
	});

	const result = yield* ctx.callFunction(fn, args, line);
	if (result.error) ctx.errors.push(result.error);
}

// === Function calls ===

export function* callFunction(
	ctx: HandlerContext,
	fn: ASTNode & { type: 'function_definition' },
	args: CValue[],
	line: number,
): Generator<void, { value: CValue; error?: string }, void> {
	if (ctx.frameDepth >= ctx.maxFrames) {
		return {
			value: { type: primitiveType('int'), data: 0, address: 0 },
			error: `Stack overflow: exceeded ${ctx.maxFrames} frames`,
		};
	}

	ctx.frameDepth++;
	const savedSP = ctx.memory.saveStackPointer();
	const callerName = ctx.memory.currentScopeName() ?? '_start';

	ctx.memory.pushScopeRuntime(fn.name);
	const declaredParams: CValue[] = [];
	for (let i = 0; i < fn.params.length; i++) {
		const paramType = ctx.typeReg.resolve(fn.params[i].typeSpec);
		const arg = args[i] ? Evaluator.decayArrayToPointer(args[i]) : undefined;
		const v = ctx.memory.declareVariableRuntime(fn.params[i].name, paramType, arg?.data ?? 0);
		declaredParams.push(v);
	}

	for (let i = 0; i < fn.params.length; i++) {
		const paramType = ctx.typeReg.resolve(fn.params[i].typeSpec);
		if (isPointerType(paramType) && args[i]?.data != null && args[i].data !== 0) {
			const blockId = ctx.memory.getHeapBlockIdByAddress(args[i].data!);
			if (blockId) {
				ctx.memory.setPointerTarget(fn.params[i].name, blockId);
			}
		}
	}

	const params = fn.params.map((p, i) => {
		const paramType = ctx.typeReg.resolve(p.typeSpec);
		const argVal = args[i]?.data ?? 0;
		let children: ChildSpec[] | undefined;

		if (isStructType(paramType)) {
			const srcAddr = args[i]?.address ?? 0;
			const initValues = new Map<string, string>();
			for (const field of paramType.fields) {
				const val = ctx.memory.readMemory(srcAddr + field.offset);
				if (val !== undefined) initValues.set(field.name, String(val));
			}
			children = buildStructChildSpecs(paramType, initValues);

			const destAddr = declaredParams[i].address;
			for (const field of paramType.fields) {
				const val = ctx.memory.readMemory(srcAddr + field.offset);
				if (val !== undefined) ctx.memory.writeMemory(destAddr + field.offset, val);
			}
		}

		return {
			name: p.name,
			type: paramType,
			value: isStructType(paramType) ? '' : formatValue(ctx.memory, paramType, argVal),
			address: declaredParams[i].address,
			children,
		};
	});

	const callColStart = ctx.callContext?.colStart;
	const callColEnd = ctx.callContext?.colEnd;
	ctx.memory.beginStep(
		{ line, colStart: callColStart, colEnd: callColEnd },
		`Call ${fn.name}(${params.map((p) => p.name).join(', ')})`,
	);
	ctx.stepCount++;

	ctx.memory.emitScopeEntry(fn.name, params, {
		caller: `${callerName}()`,
		file: '',
		line: fn.line,
	});

	for (const param of params) {
		if (param.address !== undefined) {
			ctx.memory.emitVariableEntry(param.name, param.type, param.value, param.address, param.children);
		}
	}

	ctx.returnFlag = false;
	ctx.returnValue = null;

	if (fn.body.type === 'compound_statement') {
		yield* ctx.dispatchStatements(fn.body.children);
	}

	const retVal = ctx.returnValue ?? { type: primitiveType('int'), data: 0, address: 0 };
	ctx.returnFlag = false;
	ctx.returnValue = null;

	const declVar = ctx.callContext?.varName;
	const retEval = declVar
		? `→ ${declVar} = ${retVal.data ?? 0}`
		: `→ ${retVal.data ?? 0}`;
	ctx.memory.beginStep({ line }, `Return from ${fn.name}()`, retEval);
	ctx.stepCount++;
	ctx.memory.emitScopeExit();

	ctx.memory.popScopeRuntime();
	ctx.memory.restoreStackPointer(savedSP);
	ctx.frameDepth--;

	return { value: retVal };
}

// === Leak detection ===

export function detectLeaks(memory: Memory): void {
	const blocks = memory.getAllHeapBlocks();
	for (const [addr, block] of blocks) {
		if (block.status === 'allocated') {
			const blockId = memory.getHeapBlockIdByAddress(addr);
			if (blockId) {
				memory.leakHeapById(blockId);
			}
		}
	}
}

// === Shared helpers ===

export function formatValue(memory: Memory, type: CType, data: number | null, initialized = true): string {
	if (!initialized) return '(uninit)';
	if (data === null) return '0';
	if (isFunctionPointerType(type) && data !== 0) {
		const target = memory.getFunctionByIndex(data);
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

export function describeExpr(node: ASTNode): string {
	switch (node.type) {
		case 'identifier': return node.name;
		case 'number_literal': return String(node.value);
		case 'string_literal': return `"${node.value}"`;
		case 'null_literal': return 'NULL';
		case 'binary_expression':
			return `${describeExpr(node.left)} ${node.operator} ${describeExpr(node.right)}`;
		case 'unary_expression':
			if (node.prefix) return `${node.operator}${describeExpr(node.operand)}`;
			return `${describeExpr(node.operand)}${node.operator}`;
		case 'call_expression':
			return `${node.callee}(${node.args.map((a) => describeExpr(a)).join(', ')})`;
		case 'member_expression':
			return `${describeExpr(node.object)}${node.arrow ? '->' : '.'}${node.field}`;
		case 'subscript_expression':
			return `${describeExpr(node.object)}[${describeExpr(node.index)}]`;
		case 'sizeof_expression':
			return `sizeof(${node.targetType.structName ?? node.targetType.base})`;
		default:
			return '...';
	}
}
