import type { ASTNode, CType, CValue } from './types';
import { Environment, formatAddress } from './environment';
import {
	sizeOf,
	primitiveType,
	pointerType,
	isPointerType,
	isStructType,
	isArrayType,
	TypeRegistry,
	typeToString,
} from './types-c';

/** Truncate to 32-bit signed integer (C int semantics) */
function toInt32(n: number): number {
	return n | 0;
}

export type EvalResult = {
	value: CValue;
	error?: string;
};

export type CallHandler = (name: string, args: CValue[], line: number) => EvalResult;

export class Evaluator {
	constructor(
		private env: Environment,
		private typeReg: TypeRegistry,
		private onCall?: CallHandler,
	) {}

	eval(node: ASTNode): EvalResult {
		switch (node.type) {
			case 'number_literal':
				return this.ok(node.value);

			case 'char_literal':
				return this.ok(node.value);

			case 'string_literal':
				// Strings are not fully supported; return address 0
				return this.ok(0);

			case 'null_literal':
				return this.ok(0);

			case 'identifier':
				return this.evalIdentifier(node.name, node.line);

			case 'binary_expression':
				return this.evalBinary(node);

			case 'unary_expression':
				return this.evalUnary(node);

			case 'assignment':
				return this.evalAssignment(node);

			case 'call_expression':
				return this.evalCall(node);

			case 'member_expression':
				return this.evalMember(node);

			case 'subscript_expression':
				return this.evalSubscript(node);

			case 'cast_expression':
				return this.evalCast(node);

			case 'sizeof_expression':
				return this.evalSizeof(node);

			case 'sizeof_expr':
				return this.evalSizeofExpr(node);

			case 'conditional_expression':
				return this.evalConditional(node);

			case 'comma_expression':
				return this.evalComma(node);

			case 'init_list':
				// Init lists are handled by the interpreter, not evaluator
				return this.ok(0);

			default:
				return this.err(`Cannot evaluate expression of type '${node.type}'`, node.type === 'expression_statement' ? (node as any).line : 0);
		}
	}

	// === Helpers ===

	private ok(data: number | null, type?: CType): EvalResult {
		return {
			value: {
				type: type ?? primitiveType('int'),
				data: data ?? 0,
				address: 0,
			},
		};
	}

	private err(message: string, _line?: number): EvalResult {
		return {
			value: { type: primitiveType('int'), data: 0, address: 0 },
			error: message,
		};
	}

	// === Identifier ===

	private evalIdentifier(name: string, line: number): EvalResult {
		const v = this.env.lookupVariable(name);
		if (!v) return this.err(`Undefined variable '${name}' at line ${line}`);
		return { value: v };
	}

	// === Binary ===

	private evalBinary(node: ASTNode & { type: 'binary_expression' }): EvalResult {
		// Short-circuit for logical operators
		if (node.operator === '&&') {
			const left = this.eval(node.left);
			if (left.error) return left;
			if (!left.value.data) return this.ok(0);
			const right = this.eval(node.right);
			if (right.error) return right;
			return this.ok(right.value.data ? 1 : 0);
		}
		if (node.operator === '||') {
			const left = this.eval(node.left);
			if (left.error) return left;
			if (left.value.data) return this.ok(1);
			const right = this.eval(node.right);
			if (right.error) return right;
			return this.ok(right.value.data ? 1 : 0);
		}

		const left = this.eval(node.left);
		if (left.error) return left;
		const right = this.eval(node.right);
		if (right.error) return right;

		const l = left.value.data ?? 0;
		const r = right.value.data ?? 0;

		// Pointer arithmetic
		if (isPointerType(left.value.type) && !isPointerType(right.value.type)) {
			if (node.operator === '+') {
				const elemSize = sizeOf(left.value.type.pointsTo);
				return this.ok(l + r * elemSize, left.value.type);
			}
			if (node.operator === '-') {
				const elemSize = sizeOf(left.value.type.pointsTo);
				return this.ok(l - r * elemSize, left.value.type);
			}
		}

		switch (node.operator) {
			case '+': return this.ok(toInt32(l + r));
			case '-': return this.ok(toInt32(l - r));
			case '*': return this.ok(toInt32(Math.imul(l, r)));
			case '/':
				if (r === 0) return this.err(`Division by zero at line ${node.line}`);
				return this.ok(toInt32(Math.trunc(l / r)));
			case '%':
				if (r === 0) return this.err(`Division by zero at line ${node.line}`);
				return this.ok(toInt32(l % r));
			case '<': return this.ok(l < r ? 1 : 0);
			case '>': return this.ok(l > r ? 1 : 0);
			case '<=': return this.ok(l <= r ? 1 : 0);
			case '>=': return this.ok(l >= r ? 1 : 0);
			case '==': return this.ok(l === r ? 1 : 0);
			case '!=': return this.ok(l !== r ? 1 : 0);
			case '&': return this.ok(l & r);
			case '|': return this.ok(l | r);
			case '^': return this.ok(l ^ r);
			case '<<': return this.ok(l << r);
			case '>>': return this.ok(l >> r);
			default:
				return this.err(`Unknown operator '${node.operator}'`);
		}
	}

	// === Unary ===

	private evalUnary(node: ASTNode & { type: 'unary_expression' }): EvalResult {
		const { operator, operand, prefix } = node;

		// Pre/post increment/decrement
		if (operator === '++' || operator === '--') {
			const result = this.eval(operand);
			if (result.error) return result;
			const oldVal = result.value.data ?? 0;

			// Scale by sizeof(*ptr) for pointer types
			const step = isPointerType(result.value.type) ? sizeOf(result.value.type.pointsTo) : 1;
			const newVal = operator === '++' ? toInt32(oldVal + step) : toInt32(oldVal - step);

			// Update the variable
			if (operand.type === 'identifier') {
				this.env.setVariable(operand.name, newVal);
			}

			return this.ok(prefix ? newVal : oldVal, result.value.type);
		}

		// Address-of
		if (operator === '&') {
			const result = this.eval(operand);
			if (result.error) return result;
			return this.ok(result.value.address, pointerType(result.value.type));
		}

		// Dereference
		if (operator === '*') {
			const result = this.eval(operand);
			if (result.error) return result;
			if (result.value.data === 0 || result.value.data === null) {
				return this.err(`Null pointer dereference at line ${node.line}`);
			}
			// We can't actually read memory — the interpreter handles this
			// Return a value pointing to the address
			const ptrType = result.value.type;
			const pointedType = isPointerType(ptrType) ? ptrType.pointsTo : primitiveType('int');
			return {
				value: {
					type: pointedType,
					data: null,
					address: result.value.data,
				},
			};
		}

		const result = this.eval(operand);
		if (result.error) return result;
		const v = result.value.data ?? 0;

		switch (operator) {
			case '-': return this.ok(toInt32(-v));
			case '+': return this.ok(v);
			case '!': return this.ok(v === 0 ? 1 : 0);
			case '~': return this.ok(~v);
			default:
				return this.err(`Unknown unary operator '${operator}'`);
		}
	}

	// === Assignment ===

	private evalAssignment(node: ASTNode & { type: 'assignment' }): EvalResult {
		const right = this.eval(node.value);
		if (right.error) return right;

		if (node.target.type === 'identifier') {
			const existing = this.env.lookupVariable(node.target.name);
			if (!existing) return this.err(`Undefined variable '${node.target.name}'`);

			let newVal = right.value.data ?? 0;
			const oldVal = existing.data ?? 0;

			switch (node.operator) {
				case '=': break;
				case '+=': newVal = oldVal + newVal; break;
				case '-=': newVal = oldVal - newVal; break;
				case '*=': newVal = oldVal * newVal; break;
				case '/=':
					if (newVal === 0) return this.err(`Division by zero at line ${node.line}`);
					newVal = Math.trunc(oldVal / newVal);
					break;
				case '%=':
					if (newVal === 0) return this.err(`Division by zero at line ${node.line}`);
					newVal = oldVal % newVal;
					break;
				case '&=': newVal = oldVal & newVal; break;
				case '|=': newVal = oldVal | newVal; break;
				case '^=': newVal = oldVal ^ newVal; break;
				case '<<=': newVal = oldVal << newVal; break;
				case '>>=': newVal = oldVal >> newVal; break;
				default:
					return this.err(`Unknown assignment operator '${node.operator}'`);
			}

			this.env.setVariable(node.target.name, newVal);
			return this.ok(newVal, existing.type);
		}

		// For member/subscript assignments, return the value — the interpreter handles the side effects
		return { value: right.value };
	}

	// === Call ===

	private evalCall(node: ASTNode & { type: 'call_expression' }): EvalResult {
		const args: CValue[] = [];
		for (const arg of node.args) {
			const result = this.eval(arg);
			if (result.error) return result;
			args.push(result.value);
		}

		if (this.onCall) {
			return this.onCall(node.callee, args, node.line);
		}

		return this.err(`No call handler for '${node.callee}'`);
	}

	// === Member access ===

	private evalMember(node: ASTNode & { type: 'member_expression' }): EvalResult {
		const obj = this.eval(node.object);
		if (obj.error) return obj;

		// For arrow operator, check null
		if (node.arrow && (obj.value.data === 0 || obj.value.data === null)) {
			return this.err(`Null pointer dereference at line ${node.line}`);
		}

		// Look up the struct type to find the field
		let structType: CType | undefined;
		if (node.arrow && isPointerType(obj.value.type)) {
			structType = obj.value.type.pointsTo;
		} else {
			structType = obj.value.type;
		}

		if (structType && isStructType(structType)) {
			const field = structType.fields.find((f) => f.name === node.field);
			if (field) {
				const baseAddr = node.arrow ? (obj.value.data ?? 0) : obj.value.address;
				return {
					value: {
						type: field.type,
						data: null, // actual value retrieved by interpreter
						address: baseAddr + field.offset,
					},
				};
			}
		}

		// Fallback — return a placeholder
		return {
			value: {
				type: primitiveType('int'),
				data: null,
				address: 0,
			},
		};
	}

	// === Subscript ===

	private evalSubscript(node: ASTNode & { type: 'subscript_expression' }): EvalResult {
		const obj = this.eval(node.object);
		if (obj.error) return obj;
		const idx = this.eval(node.index);
		if (idx.error) return idx;

		const index = idx.value.data ?? 0;
		let elemType: CType = primitiveType('int');
		let baseAddr = obj.value.data ?? obj.value.address;

		if (isPointerType(obj.value.type)) {
			elemType = obj.value.type.pointsTo;
		} else if (isArrayType(obj.value.type)) {
			elemType = obj.value.type.elementType;
			baseAddr = obj.value.address;
		}

		const elemSize = sizeOf(elemType);
		return {
			value: {
				type: elemType,
				data: null, // actual value retrieved by interpreter
				address: baseAddr + index * elemSize,
			},
		};
	}

	// === Cast ===

	private evalCast(node: ASTNode & { type: 'cast_expression' }): EvalResult {
		const result = this.eval(node.value);
		if (result.error) return result;

		const targetType = this.typeReg.resolve(node.targetType);
		return {
			value: {
				type: targetType,
				data: result.value.data,
				address: result.value.address,
			},
		};
	}

	// === Sizeof ===

	private evalSizeof(node: ASTNode & { type: 'sizeof_expression' }): EvalResult {
		const type = this.typeReg.resolve(node.targetType);
		return this.ok(sizeOf(type));
	}

	private evalSizeofExpr(node: ASTNode & { type: 'sizeof_expr' }): EvalResult {
		const result = this.eval(node.value);
		if (result.error) return result;
		return this.ok(sizeOf(result.value.type));
	}

	// === Conditional (ternary) ===

	private evalConditional(node: ASTNode & { type: 'conditional_expression' }): EvalResult {
		const cond = this.eval(node.condition);
		if (cond.error) return cond;
		return cond.value.data ? this.eval(node.consequent) : this.eval(node.alternate);
	}

	// === Comma ===

	private evalComma(node: ASTNode & { type: 'comma_expression' }): EvalResult {
		let result: EvalResult = this.ok(0);
		for (const expr of node.expressions) {
			result = this.eval(expr);
			if (result.error) return result;
		}
		return result;
	}

	// === Utility: build access path from AST ===

	static buildAccessPath(node: ASTNode): string[] {
		if (node.type === 'identifier') {
			return [node.name];
		}
		if (node.type === 'member_expression') {
			return [...Evaluator.buildAccessPath(node.object), node.field];
		}
		if (node.type === 'subscript_expression') {
			return [...Evaluator.buildAccessPath(node.object)];
		}
		if (node.type === 'unary_expression' && node.operator === '*') {
			return Evaluator.buildAccessPath(node.operand);
		}
		return [];
	}
}
