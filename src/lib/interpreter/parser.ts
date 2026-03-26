import type { Node, Parser as ParserType } from 'web-tree-sitter';
import type { ASTNode, ASTCaseClause, CTypeSpec, ASTParam, ASTStructField } from './types';

let cachedParser: ParserType | null = null;

export async function initTreeSitter(wasmPath?: string, langPath?: string): Promise<ParserType> {
	if (cachedParser) return cachedParser;

	const TreeSitter = await import('web-tree-sitter');
	await TreeSitter.Parser.init({
		locateFile: () => wasmPath ?? '/tree-sitter.wasm',
	});
	const parser = new TreeSitter.Parser();
	const lang = await TreeSitter.Language.load(langPath ?? '/tree-sitter-c.wasm');
	parser.setLanguage(lang);
	cachedParser = parser;
	return parser;
}

export function resetParserCache(): void {
	cachedParser = null;
}

export type ParseResult = {
	result: ASTNode & { type: 'translation_unit' };
	errors: string[];
};

export function parseSource(parser: ParserType, source: string): ParseResult {
	const tree = parser.parse(source);
	if (!tree) {
		return { result: { type: 'translation_unit', children: [] }, errors: ['Failed to parse source'] };
	}
	const errors: string[] = [];
	const children: ASTNode[] = [];

	for (let i = 0; i < tree.rootNode.childCount; i++) {
		const child = tree.rootNode.child(i)!;

		if (hasError(child)) {
			errors.push(`Syntax error at line ${child.startPosition.row + 1}: unexpected '${child.text.slice(0, 40)}'`);
			continue;
		}

		const node = convertNode(child, errors);
		if (node) children.push(node);
	}

	// Scan entire tree for deeply nested errors that error recovery may have buried
	collectDeepErrors(tree.rootNode, errors);

	return {
		result: { type: 'translation_unit', children },
		errors,
	};
}

function collectDeepErrors(node: Node, errors: string[]): void {
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i)!;
		if (child.type === 'ERROR') {
			const line = child.startPosition.row + 1;
			const col = child.startPosition.column + 1;
			const text = child.text.slice(0, 30).replace(/\n/g, ' ');
			const msg = `Syntax error at line ${line}, col ${col}: unexpected '${text}'`;
			if (!errors.includes(msg)) {
				errors.push(msg);
			}
		} else if (child.isMissing) {
			const line = child.startPosition.row + 1;
			const col = child.startPosition.column + 1;
			errors.push(`Syntax error at line ${line}, col ${col}: missing '${child.type}'`);
		} else {
			collectDeepErrors(child, errors);
		}
	}
}

function hasError(node: Node): boolean {
	if (node.type === 'ERROR' || node.isMissing) return true;
	for (let i = 0; i < node.childCount; i++) {
		if (node.child(i)!.type === 'ERROR') return true;
	}
	return false;
}

function line(node: Node): number {
	return node.startPosition.row + 1;
}

function convertNode(node: Node, errors: string[]): ASTNode | null {
	switch (node.type) {
		case 'function_definition':
			return convertFunctionDef(node, errors);
		case 'declaration':
			return convertDeclaration(node, errors);
		case 'struct_specifier':
			return convertStructDef(node, errors);
		case 'expression_statement':
			return convertExpressionStatement(node, errors);
		case 'return_statement':
			return convertReturn(node, errors);
		case 'compound_statement':
			return convertCompound(node, errors);
		case 'if_statement':
			return convertIf(node, errors);
		case 'for_statement':
			return convertFor(node, errors);
		case 'while_statement':
			return convertWhile(node, errors);
		case 'do_statement':
			return convertDoWhile(node, errors);
		case 'switch_statement':
			return convertSwitch(node, errors);
		case 'break_statement':
			return { type: 'break_statement', line: line(node) };
		case 'continue_statement':
			return { type: 'continue_statement', line: line(node) };
		case 'preproc_include':
		case 'preproc_ifdef':
		case 'preproc_ifndef':
		case 'preproc_def':
		case 'preproc_function_def':
		case 'preproc_if':
			errors.push(`Warning: preprocessor directives are ignored (line ${line(node)})`);
			return { type: 'preproc_include', line: line(node) };
		case 'type_definition':
			errors.push(`Warning: typedef is not supported (line ${line(node)})`);
			return null;
		case 'comment':
		case ';':
			return null;
		default:
			errors.push(`Unsupported top-level construct: ${node.type} (line ${line(node)})`);
			return null;
	}
}

// === Type parsing ===

function parseTypeSpec(node: Node, errors: string[]): CTypeSpec {
	// Walk through the type specifier tree to build CTypeSpec
	const spec: CTypeSpec = { base: 'int', pointer: 0 };

	if (node.type === 'primitive_type' || node.type === 'sized_type_specifier') {
		spec.base = node.text;
		// Normalize sized types
		if (spec.base === 'unsigned int' || spec.base === 'signed int') spec.base = 'int';
		if (spec.base === 'unsigned char' || spec.base === 'signed char') spec.base = 'char';
		if (spec.base === 'unsigned short' || spec.base === 'signed short') spec.base = 'short';
		if (spec.base === 'unsigned long' || spec.base === 'signed long') spec.base = 'long';
	} else if (node.type === 'struct_specifier') {
		spec.base = 'struct';
		spec.structName = node.childForFieldName('name')?.text;
	} else if (node.type === 'type_identifier') {
		spec.base = node.text;
	} else {
		spec.base = node.text;
	}

	return spec;
}

function parseDeclarator(node: Node, baseSpec: CTypeSpec, errors: string[]): { name: string; typeSpec: CTypeSpec } {
	let spec = { ...baseSpec };
	let current = node;

	// Unwrap pointer declarators
	while (current.type === 'pointer_declarator') {
		spec = { ...spec, pointer: spec.pointer + 1 };
		current = current.childForFieldName('declarator')!;
	}

	// Handle array declarator(s) — supports multi-dimensional: int arr[3][4]
	if (current.type === 'array_declarator') {
		const arraySizes: number[] = [];
		while (current.type === 'array_declarator') {
			const sizeNode = current.childForFieldName('size');
			const arraySize = sizeNode ? parseInt(sizeNode.text) : 0;
			arraySizes.push(arraySize);
			current = current.childForFieldName('declarator')!;
		}
		// arraySizes is [3, 4] for int arr[3][4] (outermost first)
		if (arraySizes.length === 1) {
			spec = { ...spec, array: arraySizes[0] };
		} else {
			spec = { ...spec, arrays: arraySizes };
		}
		return { name: current.text, typeSpec: spec };
	}

	// Handle function declarator (for function pointer params we skip)
	if (current.type === 'function_declarator') {
		return { name: current.childForFieldName('declarator')?.text ?? '', typeSpec: spec };
	}

	return { name: current.text, typeSpec: spec };
}

// === Function definitions ===

function convertFunctionDef(node: Node, errors: string[]): ASTNode {
	const typeNode = node.childForFieldName('type')!;
	const declaratorNode = node.childForFieldName('declarator')!;
	const bodyNode = node.childForFieldName('body')!;

	const returnType = parseTypeSpec(typeNode, errors);

	// Get function name and params from declarator
	let funcDecl = declaratorNode;
	while (funcDecl.type === 'pointer_declarator') {
		returnType.pointer++;
		funcDecl = funcDecl.childForFieldName('declarator')!;
	}

	const nameNode = funcDecl.childForFieldName('declarator');
	const name = nameNode?.text ?? funcDecl.text;

	const paramsNode = funcDecl.childForFieldName('parameters');
	const params: ASTParam[] = [];

	if (paramsNode) {
		for (let i = 0; i < paramsNode.childCount; i++) {
			const param = paramsNode.child(i)!;
			if (param.type === 'parameter_declaration') {
				const pTypeNode = param.childForFieldName('type')!;
				const pDeclNode = param.childForFieldName('declarator');
				const pType = parseTypeSpec(pTypeNode, errors);

				if (pDeclNode) {
					const { name: pName, typeSpec } = parseDeclarator(pDeclNode, pType, errors);
					params.push({ name: pName, typeSpec });
				} else if (pTypeNode.text !== 'void') {
					params.push({ name: '', typeSpec: pType });
				}
			}
		}
	}

	const body = convertNode(bodyNode, errors) ?? { type: 'compound_statement' as const, children: [], line: line(bodyNode) };

	return {
		type: 'function_definition',
		returnType,
		name,
		params,
		body,
		line: line(node),
	};
}

// === Declarations ===

function convertDeclaration(node: Node, errors: string[]): ASTNode | null {
	const typeNode = node.childForFieldName('type')!;

	if (!typeNode) return null;

	// Check if this is a struct definition (no declarator, just struct definition)
	if (typeNode.type === 'struct_specifier' && typeNode.childForFieldName('body')) {
		return convertStructDef(typeNode, errors);
	}

	const baseType = parseTypeSpec(typeNode, errors);
	const declaratorNode = node.childForFieldName('declarator');

	if (!declaratorNode) return null;

	// Handle init_declarator (has value)
	let declNode = declaratorNode;
	let initNode: Node | null = null;

	if (declaratorNode.type === 'init_declarator') {
		declNode = declaratorNode.childForFieldName('declarator')!;
		initNode = declaratorNode.childForFieldName('value');
	}

	const { name, typeSpec } = parseDeclarator(declNode, baseType, errors);

	const initializer = initNode ? (convertExpression(initNode, errors) ?? undefined) : undefined;

	return {
		type: 'declaration',
		declType: typeSpec,
		name,
		initializer,
		line: line(node),
	};
}

// === Struct definitions ===

function convertStructDef(node: Node, errors: string[]): ASTNode | null {
	const nameNode = node.childForFieldName('name');
	const bodyNode = node.childForFieldName('body');

	if (!nameNode || !bodyNode) return null;

	const fields: ASTStructField[] = [];

	for (let i = 0; i < bodyNode.childCount; i++) {
		const child = bodyNode.child(i)!;
		if (child.type === 'field_declaration') {
			const fTypeNode = child.childForFieldName('type')!;
			const fDeclNode = child.childForFieldName('declarator')!;
			if (fTypeNode && fDeclNode) {
				const fType = parseTypeSpec(fTypeNode, errors);
				const { name: fName, typeSpec } = parseDeclarator(fDeclNode, fType, errors);
				fields.push({ name: fName, typeSpec });
			}
		}
	}

	return {
		type: 'struct_definition',
		name: nameNode.text,
		fields,
		line: line(node),
	};
}

// === Statements ===

function convertCompound(node: Node, errors: string[]): ASTNode {
	const children: ASTNode[] = [];
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i)!;
		if (child.type === '{' || child.type === '}') continue;
		if (child.type === 'comment') continue;
		const converted = convertNode(child, errors) ?? convertStatementNode(child, errors);
		if (converted) children.push(converted);
	}
	return { type: 'compound_statement', children, line: line(node) };
}

function convertStatementNode(node: Node, errors: string[]): ASTNode | null {
	switch (node.type) {
		case 'declaration':
			return convertDeclaration(node, errors);
		case 'expression_statement':
			return convertExpressionStatement(node, errors);
		case 'return_statement':
			return convertReturn(node, errors);
		case 'if_statement':
			return convertIf(node, errors);
		case 'for_statement':
			return convertFor(node, errors);
		case 'while_statement':
			return convertWhile(node, errors);
		case 'do_statement':
			return convertDoWhile(node, errors);
		case 'switch_statement':
			return convertSwitch(node, errors);
		case 'compound_statement':
			return convertCompound(node, errors);
		case 'break_statement':
			return { type: 'break_statement', line: line(node) };
		case 'continue_statement':
			return { type: 'continue_statement', line: line(node) };
		default:
			errors.push(`Unsupported statement: ${node.type} (line ${line(node)})`);
			return null;
	}
}

function convertExpressionStatement(node: Node, errors: string[]): ASTNode | null {
	// expression_statement has one child (the expression) + semicolon
	const exprNode = node.childCount > 0 ? node.child(0) : null;
	if (!exprNode || exprNode.type === ';') return null;

	const expr = convertExpression(exprNode, errors);
	if (!expr) return null;

	// If the expression is an assignment, promote it
	if (expr.type === 'assignment') {
		return { ...expr, line: line(node) };
	}

	return { type: 'expression_statement', expression: expr, line: line(node) };
}

function convertReturn(node: Node, errors: string[]): ASTNode {
	// Return value is an expression child
	const children = [];
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i)!;
		if (child.type !== 'return' && child.type !== ';') {
			children.push(child);
		}
	}

	const value = children.length > 0 ? (convertExpression(children[0], errors) ?? undefined) : undefined;
	return { type: 'return_statement', value, line: line(node) };
}

function convertIf(node: Node, errors: string[]): ASTNode {
	const condition = convertExpression(node.childForFieldName('condition')!, errors)!;
	const consequent = convertNode(node.childForFieldName('consequence')!, errors)!;
	const altNode = node.childForFieldName('alternative');
	let alternate: ASTNode | undefined;

	if (altNode) {
		// else_clause wraps the actual statement
		if (altNode.type === 'else_clause') {
			// Find the statement inside the else clause (skip 'else' keyword)
			for (let i = 0; i < altNode.childCount; i++) {
				const child = altNode.child(i)!;
				if (child.type !== 'else') {
					alternate = convertNode(child, errors) ?? convertStatementNode(child, errors) ?? undefined;
					break;
				}
			}
		} else {
			alternate = convertNode(altNode, errors) ?? undefined;
		}
	}

	const condNode = node.childForFieldName('condition')!;
	const result: ASTNode & { type: 'if_statement' } = { type: 'if_statement', condition, consequent, alternate, line: line(node) };
	if (condNode) {
		result.condColStart = condNode.startPosition.column;
		result.condColEnd = condNode.endPosition.column;
	}
	return result;
}

function convertFor(node: Node, errors: string[]): ASTNode {
	const initNode = node.childForFieldName('initializer');
	const condNode = node.childForFieldName('condition');
	const updateNode = node.childForFieldName('update');
	const bodyNode = node.childForFieldName('body')!;

	const init = initNode ? (convertNode(initNode, errors) ?? convertExpression(initNode, errors)) : undefined;
	const condition = condNode ? convertExpression(condNode, errors) : undefined;
	const update = updateNode ? convertExpression(updateNode, errors) : undefined;
	const body = convertNode(bodyNode, errors)!;

	// Extract column ranges for condition and update
	const result: ASTNode & { type: 'for_statement' } = {
		type: 'for_statement',
		init: init ?? undefined,
		condition: condition ?? undefined,
		update: update ?? undefined,
		body,
		line: line(node),
	};

	if (condNode) {
		result.condColStart = condNode.startPosition.column;
		result.condColEnd = condNode.endPosition.column;
	}
	if (updateNode) {
		result.updateColStart = updateNode.startPosition.column;
		result.updateColEnd = updateNode.endPosition.column;
	}

	return result;
}

function convertWhile(node: Node, errors: string[]): ASTNode {
	const condNode = node.childForFieldName('condition')!;
	const condition = convertExpression(condNode, errors)!;
	const body = convertNode(node.childForFieldName('body')!, errors)!;
	const result: ASTNode & { type: 'while_statement' } = { type: 'while_statement', condition, body, line: line(node) };
	result.condColStart = condNode.startPosition.column;
	result.condColEnd = condNode.endPosition.column;
	return result;
}

function convertDoWhile(node: Node, errors: string[]): ASTNode {
	const body = convertNode(node.childForFieldName('body')!, errors)!;
	const condNode = node.childForFieldName('condition')!;
	const condition = convertExpression(condNode, errors)!;
	const result: ASTNode & { type: 'do_while_statement' } = { type: 'do_while_statement', body, condition, line: line(node) };
	result.condColStart = condNode.startPosition.column;
	result.condColEnd = condNode.endPosition.column;
	return result;
}

function convertSwitch(node: Node, errors: string[]): ASTNode {
	const condNode = node.childForFieldName('condition')!;
	const condition = convertExpression(condNode, errors)!;
	const body = node.childForFieldName('body')!;

	const cases: ASTCaseClause[] = [];

	for (let i = 0; i < body.childCount; i++) {
		const child = body.child(i)!;
		if (child.type === 'case_statement') {
			const valueNode = child.childForFieldName('value');
			const value = valueNode ? convertExpression(valueNode, errors) : undefined;
			const isDefault = !valueNode;

			const statements: ASTNode[] = [];
			let afterColon = false;
			for (let j = 0; j < child.childCount; j++) {
				const stmtNode = child.child(j)!;
				if (stmtNode.type === ':') { afterColon = true; continue; }
				if (!afterColon) continue;
				const stmt = convertNode(stmtNode, errors) ?? convertStatementNode(stmtNode, errors);
				if (stmt) statements.push(stmt);
			}

			cases.push({
				kind: isDefault ? 'default' : 'case',
				value: value ?? undefined,
				statements,
				line: line(child),
			});
		}
	}

	return { type: 'switch_statement', expression: condition, cases, line: line(node) };
}

// === Expressions ===

export function convertExpression(node: Node, errors: string[]): ASTNode | null {
	if (!node) return null;

	switch (node.type) {
		case 'number_literal':
			return { type: 'number_literal', value: parseNumber(node.text), line: line(node) };

		case 'string_literal':
			return { type: 'string_literal', value: node.text.slice(1, -1), line: line(node) };

		case 'char_literal':
			return { type: 'char_literal', value: node.text.charCodeAt(1), line: line(node) };

		case 'null':
		case 'nullptr':
			return { type: 'null_literal', line: line(node) };

		case 'true':
			return { type: 'number_literal', value: 1, line: line(node) };

		case 'false':
			return { type: 'number_literal', value: 0, line: line(node) };

		case 'identifier':
			if (node.text === 'NULL') {
				return { type: 'null_literal', line: line(node) };
			}
			return { type: 'identifier', name: node.text, line: line(node) };

		case 'binary_expression':
			return convertBinary(node, errors);

		case 'unary_expression':
		case 'pointer_expression':
			return convertUnary(node, errors);

		case 'update_expression':
			return convertUpdate(node, errors);

		case 'assignment_expression':
			return convertAssignment(node, errors);

		case 'call_expression':
			return convertCall(node, errors);

		case 'field_expression':
			return convertFieldExpr(node, errors);

		case 'subscript_expression':
			return convertSubscript(node, errors);

		case 'parenthesized_expression':
			return convertExpression(node.child(1)!, errors);

		case 'cast_expression': {
			const typeNode = node.childForFieldName('type')!;
			const valueNode = node.childForFieldName('value')!;
			const targetType = parseCastType(typeNode, errors);
			const value = convertExpression(valueNode, errors)!;
			return { type: 'cast_expression', targetType, value, line: line(node) };
		}

		case 'sizeof_expression': {
			const argNode = node.childForFieldName('type') ?? node.childForFieldName('value');
			if (argNode && (argNode.type === 'type_descriptor' || argNode.type === 'parenthesized_type_descriptor')) {
				const targetType = parseCastType(argNode, errors);
				return { type: 'sizeof_expression', targetType, line: line(node) };
			}
			if (argNode) {
				const value = convertExpression(argNode, errors)!;
				return { type: 'sizeof_expr', value, line: line(node) };
			}
			// fallback: try children
			for (let i = 0; i < node.childCount; i++) {
				const child = node.child(i)!;
				if (child.type === 'parenthesized_expression') {
					const inner = child.child(1)!;
					if (inner.type === 'type_descriptor') {
						const targetType = parseCastType(inner, errors);
						return { type: 'sizeof_expression', targetType, line: line(node) };
					}
					const value = convertExpression(inner, errors)!;
					return { type: 'sizeof_expr', value, line: line(node) };
				}
			}
			errors.push(`Cannot parse sizeof expression at line ${line(node)}`);
			return { type: 'number_literal', value: 0, line: line(node) };
		}

		case 'comma_expression': {
			const exprs: ASTNode[] = [];
			const left = node.childForFieldName('left');
			const right = node.childForFieldName('right');
			if (left) {
				const l = convertExpression(left, errors);
				if (l) exprs.push(l);
			}
			if (right) {
				const r = convertExpression(right, errors);
				if (r) exprs.push(r);
			}
			return { type: 'comma_expression', expressions: exprs, line: line(node) };
		}

		case 'conditional_expression': {
			const cond = convertExpression(node.childForFieldName('condition')!, errors)!;
			const cons = convertExpression(node.childForFieldName('consequence')!, errors)!;
			const alt = convertExpression(node.childForFieldName('alternative')!, errors)!;
			return { type: 'conditional_expression', condition: cond, consequent: cons, alternate: alt, line: line(node) };
		}

		case 'initializer_list': {
			const values: ASTNode[] = [];
			for (let i = 0; i < node.childCount; i++) {
				const child = node.child(i)!;
				if (child.type === '{' || child.type === '}' || child.type === ',') continue;
				const expr = convertExpression(child, errors);
				if (expr) values.push(expr);
			}
			return { type: 'init_list', values, line: line(node) };
		}

		case 'compound_literal_expression': {
			// (struct Point){1, 2} — treat as init_list for now
			const initList = node.childForFieldName('value');
			if (initList) return convertExpression(initList, errors);
			return null;
		}

		default:
			errors.push(`Unsupported expression: ${node.type} (line ${line(node)})`);
			return null;
	}
}

function convertBinary(node: Node, errors: string[]): ASTNode {
	const left = convertExpression(node.childForFieldName('left')!, errors)!;
	const right = convertExpression(node.childForFieldName('right')!, errors)!;
	const op = node.childForFieldName('operator')?.text ?? node.child(1)?.text ?? '?';
	return { type: 'binary_expression', operator: op, left, right, line: line(node) };
}

function convertUnary(node: Node, errors: string[]): ASTNode {
	const opNode = node.childForFieldName('operator') ?? node.child(0)!;
	const operandNode = node.childForFieldName('argument') ?? node.child(1)!;
	const operator = opNode.text;
	const operand = convertExpression(operandNode, errors)!;
	return { type: 'unary_expression', operator, operand, prefix: true, line: line(node) };
}

function convertUpdate(node: Node, errors: string[]): ASTNode {
	const opNode = node.childForFieldName('operator');
	const argNode = node.childForFieldName('argument');

	if (!opNode || !argNode) {
		// Fallback: parse children manually
		const first = node.child(0)!;
		const second = node.child(1)!;
		if (first.type === '++' || first.type === '--') {
			const operand = convertExpression(second, errors)!;
			return { type: 'unary_expression', operator: first.text, operand, prefix: true, line: line(node) };
		}
		const operand = convertExpression(first, errors)!;
		return { type: 'unary_expression', operator: second.text, operand, prefix: false, line: line(node) };
	}

	const prefix = opNode.startPosition.column < argNode.startPosition.column;
	const operand = convertExpression(argNode, errors)!;
	return { type: 'unary_expression', operator: opNode.text, operand, prefix, line: line(node) };
}

function convertAssignment(node: Node, errors: string[]): ASTNode {
	const left = convertExpression(node.childForFieldName('left')!, errors)!;
	const right = convertExpression(node.childForFieldName('right')!, errors)!;
	const op = node.childForFieldName('operator')?.text ?? node.child(1)?.text ?? '=';
	return { type: 'assignment', target: left, operator: op, value: right, line: line(node) };
}

function convertCall(node: Node, errors: string[]): ASTNode {
	const funcNode = node.childForFieldName('function')!;
	const argsNode = node.childForFieldName('arguments')!;

	const callee = funcNode.text;
	const args: ASTNode[] = [];

	for (let i = 0; i < argsNode.childCount; i++) {
		const child = argsNode.child(i)!;
		if (child.type === '(' || child.type === ')' || child.type === ',') continue;
		const expr = convertExpression(child, errors);
		if (expr) args.push(expr);
	}

	return {
		type: 'call_expression',
		callee,
		args,
		line: line(node),
		colStart: node.startPosition.column,
		colEnd: node.endPosition.column,
	};
}

function convertFieldExpr(node: Node, errors: string[]): ASTNode {
	const object = convertExpression(node.childForFieldName('argument')!, errors)!;
	const field = node.childForFieldName('field')!.text;
	const arrow = node.child(1)?.text === '->';
	return { type: 'member_expression', object, field, arrow, line: line(node) };
}

function convertSubscript(node: Node, errors: string[]): ASTNode {
	const object = convertExpression(node.childForFieldName('argument')!, errors)!;
	const index = convertExpression(node.childForFieldName('index')!, errors)!;
	return { type: 'subscript_expression', object, index, line: line(node) };
}

function parseCastType(node: Node, errors: string[]): CTypeSpec {
	const spec: CTypeSpec = { base: 'int', pointer: 0 };

	// Walk through type_descriptor children
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i)!;
		if (child.type === 'primitive_type' || child.type === 'sized_type_specifier') {
			spec.base = child.text;
		} else if (child.type === 'struct_specifier') {
			spec.base = 'struct';
			spec.structName = child.childForFieldName('name')?.text;
		} else if (child.type === 'type_identifier') {
			spec.base = child.text;
		} else if (child.type === 'abstract_pointer_declarator') {
			spec.pointer = countPointers(child);
		}
	}

	return spec;
}

function countPointers(node: Node): number {
	let count = 0;
	let current: Node | null = node;
	while (current && (current.type === 'abstract_pointer_declarator' || current.type === 'pointer_declarator')) {
		count++;
		current = current.childCount > 1 ? current.child(1) : null;
	}
	return count;
}

function parseNumber(text: string): number {
	if (text.startsWith('0x') || text.startsWith('0X')) return parseInt(text, 16);
	if (text.startsWith('0b') || text.startsWith('0B')) return parseInt(text.slice(2), 2);
	if (text.startsWith('0') && text.length > 1 && !text.includes('.')) return parseInt(text, 8);
	if (text.includes('.') || text.includes('e') || text.includes('E')) return parseFloat(text);
	return parseInt(text, 10);
}
