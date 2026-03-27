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
				if (callResult.value !== undefined) {
					initData = callResult.value;
					initWasFunctionCall = !!callResult.isUserFunc;
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
		ctx.memory.beginStep(
			{ line: node.line },
			formatDeclDescription(node.name, type, displayValue!),
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
): { handled: boolean; value?: number | null; isUserFunc?: boolean } {
	if (node.initializer?.type !== 'call_expression') return { handled: false };
	const call = node.initializer;

	if (call.callee === 'malloc' || call.callee === 'calloc') {
		const handled = executeMallocDecl(ctx, node, call, declType);
		return { handled };
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

	const sizeDesc = `${totalSize}`;
	const desc = `${allocator}(${formatMallocArgs(ctx, call)}) — allocate ${sizeDesc} bytes`;

	ctx.memory.beginStep({ line: decl.line }, desc);
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
		ctx.memory.beginStep({ line: decl.line }, `char *${decl.name} = "${str}"`);
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
		const desc = `${allocator}(${formatMallocArgs(ctx, call)}) — allocate ${totalSize} bytes`;
		ctx.memory.beginStep({ line: node.line }, desc);
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

	if (!sharesStep) {
		ctx.memory.beginStep({ line: node.line }, formatAssignDesc(ctx, node));
		ctx.stepCount++;
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

export function executeExpressionStatement(ctx: HandlerContext, node: ASTNode & { type: 'expression_statement' }, sharesStep: boolean): void {
	const expr = node.expression;

	if (expr.type === 'call_expression') {
		executeCallStatement(ctx, expr, node.line, sharesStep);
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
			ctx.memory.beginStep({ line: node.line }, desc);
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

export function executeCallStatement(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }, line: number, sharesStep: boolean): void {
	if (call.callee === 'free') {
		executeFreeCall(ctx, call, line, sharesStep);
		return;
	}

	if (call.callee === 'sprintf' && call.args.length >= 2) {
		const destResult = ctx.evaluator.eval(call.args[0]);
		const formatted = evaluateSprintfResult(ctx, call);

		if (!sharesStep) {
			ctx.memory.beginStep({ line }, `sprintf(${ctx.describeExpr(call.args[0])}, ...) — write "${formatted}"`);
			ctx.stepCount++;
		}

		if (!destResult.error && destResult.value.data) {
			const destName = call.args[0].type === 'identifier' ? call.args[0].name : undefined;
			if (destName) {
				const blockId = ctx.memory.getHeapBlockId(destName);
				if (blockId) {
					ctx.memory.setValueById(blockId, `"${formatted}"`);
				}
			}
		}
		return;
	}

	if (call.callee === 'printf' || call.callee === 'puts') {
		if (!sharesStep) {
			ctx.memory.beginStep({ line }, formatPrintfDesc(ctx, call));
			ctx.stepCount++;
		}
		return;
	}

	// User-defined function call as statement
	const fn = ctx.memory.getFunction(call.callee);
	if (fn) {
		executeUserFunctionCall(ctx, fn, call, line, sharesStep);
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
			executeUserFunctionCall(ctx, target.node, call, line, sharesStep);
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
		ctx.memory.beginStep({ line }, `free(${argText}) — deallocate memory`);
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

export function formatDeclDescription(name: string, type: CType, value: string): string {
	const typeStr = typeToString(type);
	if (isStructType(type)) {
		return `${typeStr} ${name} = {...}`;
	}
	if (isArrayType(type)) {
		return `${typeStr} ${name} = {...}`;
	}
	return `${typeStr} ${name} = ${value}`;
}

export function formatAssignDesc(ctx: HandlerContext, node: ASTNode & { type: 'assignment' }): string {
	const target = ctx.describeExpr(node.target);
	const value = ctx.describeExpr(node.value);

	if (node.operator === '=') {
		return `${target} = ${value}`;
	}
	return `${target} ${node.operator} ${value}`;
}

export function formatMallocArgs(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }): string {
	return call.args.map((a) => ctx.describeExpr(a)).join(', ');
}

export function formatPrintfDesc(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }): string {
	const args = call.args.map((a) => ctx.describeExpr(a)).join(', ');
	return `${call.callee}(${args})`;
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

export function evaluateSprintfResult(ctx: HandlerContext, call: ASTNode & { type: 'call_expression' }): string {
	if (call.args.length < 2) return '';
	const fmtResult = ctx.evaluator.eval(call.args[1]);
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
				const argResult = ctx.evaluator.eval(call.args[argIdx]);
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
		if (isStructType(field.type) && values[i].type === 'init_list') {
			const nestedChildren = children[i].children;
			if (nestedChildren) {
				const nestedBase = baseAddress !== undefined ? baseAddress + field.offset : undefined;
				initStructFromList(ctx, field.type, nestedChildren, values[i].values, nestedBase);
			}
			continue;
		}
		const result = ctx.evaluator.eval(values[i]);
		if (result.error) ctx.errors.push(result.error);
		const val = result.value.data ?? 0;
		children[i].value = String(val);
		if (baseAddress !== undefined) {
			ctx.memory.writeMemory(baseAddress + field.offset, val);
		}
	}
}

export function executeUserFunctionCall(
	ctx: HandlerContext,
	fn: ASTNode & { type: 'function_definition' },
	call: ASTNode & { type: 'call_expression' },
	line: number,
	sharesStep: boolean,
): void {
	const args = call.args.map((a) => {
		const r = ctx.evaluator.eval(a);
		if (r.error) ctx.errors.push(r.error);
		return r.value;
	});

	const result = ctx.callFunction(fn, args, line);
	if (result.error) ctx.errors.push(result.error);
}

// === Function calls ===

export function callFunction(
	ctx: HandlerContext,
	fn: ASTNode & { type: 'function_definition' },
	args: CValue[],
	line: number,
): { value: CValue; error?: string } {
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
			value: isStructType(paramType) ? '' : String(argVal),
			address: declaredParams[i].address,
			children,
		};
	});

	const callColStart = ctx.callContext?.colStart;
	const callColEnd = ctx.callContext?.colEnd;
	ctx.memory.beginStep(
		{ line, colStart: callColStart, colEnd: callColEnd },
		`Call ${fn.name}(${params.map((p) => p.name).join(', ')}) — push stack frame`,
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
		ctx.dispatchStatements(fn.body.children);
	}

	const retVal = ctx.returnValue ?? { type: primitiveType('int'), data: 0, address: 0 };
	ctx.returnFlag = false;
	ctx.returnValue = null;

	const declVar = ctx.callContext?.varName;
	const retDesc = declVar
		? `${fn.name}() returns ${retVal.data ?? 0}, assign to ${declVar}`
		: `${fn.name}() returns ${retVal.data ?? 0}`;
	ctx.memory.beginStep({ line }, retDesc);
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
