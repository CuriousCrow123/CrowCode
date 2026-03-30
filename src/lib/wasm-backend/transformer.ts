/**
 * Source transformer: takes user C source and injects __crow_* instrumentation calls.
 *
 * Uses tree-sitter's CST to identify insertion points, then applies text insertions
 * in reverse order (bottom-up) to preserve positions. This is text surgery, not AST
 * rewriting — the output is valid C that xcc compiles with --allow-undefined.
 */

import type { Parser as ParserType, SyntaxNode } from 'web-tree-sitter';

export type StructField = { name: string; type: string };
export type StructRegistry = Map<string, StructField[]>;
export type StepDescription = { description: string };

export type TransformResult = {
	instrumented: string;
	errors: string[];
	structRegistry: StructRegistry;
	descriptionMap: Map<number, StepDescription>;
};

type Insertion = {
	/** Byte offset in the original source */
	offset: number;
	/** Text to insert */
	text: string;
	/** Higher priority insertions go first when at same offset */
	priority: number;
};

type Replacement = {
	startOffset: number;
	endOffset: number;
	text: string;
};

/**
 * Transform C source into instrumented C with __crow_* calls.
 */
export function transformSource(parser: ParserType, source: string): TransformResult {
	const tree = parser.parse(source);
	if (!tree || !tree.rootNode) {
		return { instrumented: source, errors: ['Failed to parse source'], structRegistry: new Map(), descriptionMap: new Map() };
	}

	// Check for parse errors
	const errors: string[] = [];
	findErrors(tree.rootNode, errors);
	if (errors.length > 0) {
		return { instrumented: source, errors, structRegistry: new Map(), descriptionMap: new Map() };
	}

	const insertions: Insertion[] = [];
	const replacements: Replacement[] = [];
	const descriptionMap = new Map<number, StepDescription>();

	// Extract struct definitions for the type registry
	const structRegistry = extractStructDefinitions(tree.rootNode);

	// Walk the CST and collect instrumentation points + descriptions
	walkNode(tree.rootNode, insertions, replacements, descriptionMap);

	// Apply transformations
	let result = applyReplacements(source, replacements);
	result = applyInsertions(result, insertions, replacements);

	// Prepend __crow.h include
	result = '#include "__crow.h"\n' + result;

	return { instrumented: result, errors: [], structRegistry, descriptionMap };
}

function findErrors(node: SyntaxNode, errors: string[]): void {
	if (node.type === 'ERROR') {
		const pos = node.startPosition;
		errors.push(`Parse error at line ${pos.row + 1}, column ${pos.column + 1}: unexpected '${node.text.slice(0, 30)}'`);
	}
	for (let i = 0; i < node.childCount; i++) {
		findErrors(node.child(i)!, errors);
	}
}

/**
 * Walk the CST and collect insertion points for instrumentation.
 */
function walkNode(
	node: SyntaxNode,
	insertions: Insertion[],
	replacements: Replacement[],
	descriptionMap: Map<number, StepDescription>,
): void {
	switch (node.type) {
		case 'function_definition':
			instrumentFunction(node, insertions, replacements, descriptionMap);
			return; // Don't recurse — instrumentFunction handles children

		case 'declaration':
			// Only instrument top-level declarations inside function bodies
			if (isInFunctionBody(node)) {
				instrumentDeclaration(node, insertions, replacements, descriptionMap);
			}
			break;

		case 'expression_statement':
			if (isInFunctionBody(node)) {
				instrumentExpressionStatement(node, insertions, replacements, descriptionMap);
			}
			break;

		case 'return_statement':
			if (isInFunctionBody(node)) {
				instrumentReturn(node, insertions, descriptionMap);
			}
			break;

		case 'for_statement':
			instrumentFor(node, insertions, replacements, descriptionMap);
			return;

		case 'while_statement':
		case 'do_statement':
			instrumentLoop(node, insertions, replacements, descriptionMap);
			return;

		case 'if_statement':
			instrumentIf(node, insertions, replacements, descriptionMap);
			return;

		case 'switch_statement':
			instrumentSwitch(node, insertions, replacements, descriptionMap);
			return;

		case 'compound_statement':
			// Anonymous block inside a function body — add scope push/pop for variable shadowing
			if (isInFunctionBody(node) && node.parent?.type === 'compound_statement') {
				const blockLine = node.startPosition.row + 1;
				const openBrace = node.child(0);
				const closeBrace = node.child(node.childCount - 1);
				if (openBrace?.text === '{' && closeBrace?.text === '}') {
					insertions.push({
						offset: openBrace.endIndex,
						text: `\n\t__crow_push_scope("block", ${blockLine});\n\t__crow_step(${blockLine});`,
						priority: 8,
					});
					insertions.push({
						offset: closeBrace.startIndex,
						text: `\t__crow_pop_scope();\n`,
						priority: 0,
					});
					// Recurse into body (skip braces)
					for (let i = 1; i < node.childCount - 1; i++) {
						walkNode(node.child(i)!, insertions, replacements, descriptionMap);
					}
					return;
				}
			}
			break;
	}

	// Default: recurse into children
	for (let i = 0; i < node.childCount; i++) {
		walkNode(node.child(i)!, insertions, replacements, descriptionMap);
	}
}

/**
 * Instrument a function definition:
 * - Push scope after opening brace
 * - Declare parameters
 * - Recurse into body statements
 * - Pop scope before closing brace (if no explicit return)
 */
function instrumentFunction(
	node: SyntaxNode,
	insertions: Insertion[],
	replacements: Replacement[],
	descriptionMap: Map<number, StepDescription>,
): void {
	const declarator = node.childForFieldName('declarator');
	const body = node.childForFieldName('body');
	if (!declarator || !body) return;

	const funcName = extractFunctionName(declarator);
	const params = extractParameters(declarator);
	const line = node.startPosition.row + 1;

	const paramStr = params.map(p => p.name).join(', ');
	descriptionMap.set(line, { description: `Enter ${funcName}(${paramStr})` });

	// After opening brace of body
	const openBrace = body.child(0);
	if (!openBrace || openBrace.text !== '{') return;

	let pushText = `\n\t__crow_push_scope("${funcName}", ${line});`;

	// Declare parameters
	for (const param of params) {
		pushText += `\n\t__crow_decl("${param.name}", &${param.name}, sizeof(${param.name}), "${param.type}", ${line}, 0);`;
	}
	pushText += `\n\t__crow_step(${line});`;

	insertions.push({
		offset: openBrace.endIndex,
		text: pushText,
		priority: 10,
	});

	// Check if function has an explicit return at the end
	const hasTrailingReturn = bodyHasTrailingReturn(body);
	if (!hasTrailingReturn) {
		// Add step + __crow_pop_scope() before closing brace
		const closeBrace = body.child(body.childCount - 1);
		if (closeBrace && closeBrace.text === '}') {
			const closeLine = closeBrace.startPosition.row + 1;
			insertions.push({
				offset: closeBrace.startIndex,
				text: `\t__crow_step(${closeLine});\n\t__crow_pop_scope();\n`,
				priority: 0,
			});
		}
	}

	// Recurse into body statements (skip braces)
	for (let i = 1; i < body.childCount - 1; i++) {
		walkNode(body.child(i)!, insertions, replacements, descriptionMap);
	}
}

/**
 * Instrument a declaration: int x = 5;
 * → __crow_decl("x", &x, sizeof(x), "int", __LINE__); __crow_step(__LINE__);
 */
function instrumentDeclaration(node: SyntaxNode, insertions: Insertion[], replacements: Replacement[] | undefined, descriptionMap: Map<number, StepDescription>): void {
	const typeNode = getDeclarationType(node);
	if (!typeNode) return;

	const typeStr = typeNode.trim();
	const declarators = getDeclarators(node);
	const line = node.startPosition.row + 1;

	const names = declarators.map(d => d.name).join(', ');
	descriptionMap.set(line, { description: `Declare ${typeStr} ${names}` });

	// Check for call rewrites in initializers (e.g., malloc, calloc, scanf)
	if (replacements) {
		findAndRewriteCalls(node, replacements);
	}

	// Scan initializers for pointer dereferences to enable use-after-free detection on reads
	const derefVars = findPointerDerefsInNode(node);

	let text = '';
	for (const v of derefVars) {
		text += `\n\t__crow_set("${v}", &${v}, ${line});`;
	}
	for (const decl of declarators) {
		const flags = decl.hasInitializer ? 0 : 1;
		text += `\n\t__crow_decl("${decl.name}", &${decl.name}, sizeof(${decl.name}), "${escapeType(typeStr, decl)}", ${line}, ${flags});`;
	}
	text += `\n\t__crow_step(${line});`;

	insertions.push({
		offset: node.endIndex,
		text,
		priority: 5,
	});
}

/**
 * Instrument an expression statement (assignments, function calls, increments).
 */
function instrumentExpressionStatement(
	node: SyntaxNode,
	insertions: Insertion[],
	replacements: Replacement[],
	descriptionMap: Map<number, StepDescription>,
): void {
	const expr = node.child(0);
	if (!expr) return;

	const line = node.startPosition.row + 1;
	const exprText = expr.text.replace(/;$/, '');

	// Check for malloc/free/scanf calls first
	if (expr.type === 'assignment_expression') {
		descriptionMap.set(line, { description: `Set ${exprText}` });
		// Look for call expressions in the RHS (may be inside cast_expression)
		findAndRewriteCalls(expr, replacements);

		// Track all assigned variables (handles chained: a = b = c = 42)
		const targets = collectChainedTargets(expr);
		if (targets.length > 0) {
			// Scan RHS for pointer dereferences (enables read-after-free detection)
			const rhs = expr.childForFieldName('right');
			const derefVars = rhs ? findPointerDerefsInNode(rhs) : [];

			let text = '';
			for (const v of derefVars) {
				text += `\n\t__crow_set("${v}", &${v}, ${line});`;
			}
			// Emit __crow_set for each target (innermost first for correct eval order)
			for (const target of targets.reverse()) {
				text += `\n\t__crow_set("${target.name}", ${target.addrExpr}, ${line});`;
			}
			text += `\n\t__crow_step(${line});`;
			insertions.push({ offset: node.endIndex, text, priority: 5 });
			return;
		}
	} else if (expr.type === 'call_expression') {
		const funcNode = expr.childForFieldName('function');
		const funcName = funcNode?.text;

		descriptionMap.set(line, { description: exprText });
		// sprintf/snprintf: let libc run it, then track the destination buffer
		if (funcName === 'sprintf' || funcName === 'snprintf') {
			const args = expr.childForFieldName('arguments');
			if (args) {
				const firstArg = args.child(1); // skip '('
				if (firstArg && firstArg.type !== ')' && firstArg.type !== ',') {
					const bufName = firstArg.text;
					let text = `\n\t__crow_set("${bufName}", &${bufName}, ${line});`;
					text += `\n\t__crow_step(${line});`;
					insertions.push({ offset: node.endIndex, text, priority: 5 });
					return;
				}
			}
		}

		rewriteCallIfNeeded(expr, replacements);
		insertions.push({
			offset: node.endIndex,
			text: `\n\t__crow_step(${line});`,
			priority: 5,
		});
		return;
	} else if (expr.type === 'update_expression') {
		descriptionMap.set(line, { description: `Set ${exprText}` });
		// i++ or ++i
		const operand = expr.childForFieldName('argument') ?? expr.child(0);
		if (operand && operand.type !== 'update_expression') {
			const actualOperand = expr.text.startsWith('++') || expr.text.startsWith('--')
				? expr.child(1) : expr.child(0);
			if (actualOperand) {
				const name = actualOperand.text;
				let text = `\n\t__crow_set("${name}", &${name}, ${line});`;
				text += `\n\t__crow_step(${line});`;
				insertions.push({ offset: node.endIndex, text, priority: 5 });
				return;
			}
		}
	} else if (expr.type === 'comma_expression') {
		descriptionMap.set(line, { description: exprText });
		// Handle comma expressions — instrument after whole statement
		insertions.push({
			offset: node.endIndex,
			text: `\n\t__crow_step(${line});`,
			priority: 5,
		});
		return;
	}

	// Default: just add a step
	if (!descriptionMap.has(line)) {
		descriptionMap.set(line, { description: exprText });
	}
	insertions.push({
		offset: node.endIndex,
		text: `\n\t__crow_step(${line});`,
		priority: 5,
	});
}

/**
 * Instrument a return statement: add __crow_pop_scope() before it.
 */
function instrumentReturn(node: SyntaxNode, insertions: Insertion[], descriptionMap: Map<number, StepDescription>): void {
	const line = node.startPosition.row + 1;
	const retText = node.text.replace(/^return\s*/, '').replace(/;$/, '').trim();
	descriptionMap.set(line, { description: retText ? `return ${retText}` : 'return' });
	insertions.push({
		offset: node.startIndex,
		text: `__crow_step(${line});\n\t__crow_pop_scope();\n\t`,
		priority: 5,
	});
}

/**
 * Instrument a for loop.
 */
function instrumentFor(
	node: SyntaxNode,
	insertions: Insertion[],
	replacements: Replacement[],
	descriptionMap: Map<number, StepDescription>,
): void {
	const body = node.childForFieldName('body');
	if (!body) return;

	const initializer = node.childForFieldName('initializer');
	const condNode = node.childForFieldName('condition');
	const updateNode = node.childForFieldName('update');
	const line = node.startPosition.row + 1;

	const initText = initializer?.text ?? '';
	const condText = condNode?.text ?? '';
	const updateText = updateNode?.text ?? '';
	descriptionMap.set(line, { description: `for (${initText} ${condText}; ${updateText})` });

	// If the body is a compound_statement, instrument its contents
	if (body.type === 'compound_statement') {
		const openBrace = body.child(0);
		if (openBrace && openBrace.text === '{') {
			let text = '';

			// If initializer is a declaration, add __crow_decl for the loop var
			if (initializer && initializer.type === 'declaration') {
				const typeStr = getDeclarationType(initializer)?.trim() ?? 'int';
				const decls = getDeclarators(initializer);
				for (const decl of decls) {
					const flags = decl.hasInitializer ? 0 : 1;
					text += `\n\t__crow_decl("${decl.name}", &${decl.name}, sizeof(${decl.name}), "${escapeType(typeStr, decl)}", ${line}, ${flags});`;
				}
			}

			text += `\n\t__crow_step(${line});`;
			insertions.push({ offset: openBrace.endIndex, text, priority: 8 });
		}

		// Recurse into body statements
		for (let i = 1; i < body.childCount - 1; i++) {
			walkNode(body.child(i)!, insertions, replacements, descriptionMap);
		}

	} else {
		// Single-statement body — recurse
		walkNode(body, insertions, replacements, descriptionMap);
	}
}

/**
 * Instrument while/do-while loops.
 */
function instrumentLoop(
	node: SyntaxNode,
	insertions: Insertion[],
	replacements: Replacement[],
	descriptionMap: Map<number, StepDescription>,
): void {
	const body = node.childForFieldName('body');
	if (!body) return;

	const condNode = node.childForFieldName('condition');
	const line = node.startPosition.row + 1;

	if (node.type === 'while_statement') {
		descriptionMap.set(line, { description: `while (${condNode?.text ?? ''})` });
	} else {
		descriptionMap.set(line, { description: `do...while (${condNode?.text ?? ''})` });
	}

	if (body.type === 'compound_statement') {
		const openBrace = body.child(0);
		if (openBrace && openBrace.text === '{') {
			insertions.push({
				offset: openBrace.endIndex,
				text: `\n\t__crow_step(${line});`,
				priority: 8,
			});
		}

		for (let i = 1; i < body.childCount - 1; i++) {
			walkNode(body.child(i)!, insertions, replacements, descriptionMap);
		}
	} else {
		walkNode(body, insertions, replacements, descriptionMap);
	}
}

/**
 * Instrument if/else statements.
 */
function instrumentIf(
	node: SyntaxNode,
	insertions: Insertion[],
	replacements: Replacement[],
	descriptionMap: Map<number, StepDescription>,
): void {
	const consequence = node.childForFieldName('consequence');
	const alternative = node.childForFieldName('alternative');
	const condNode = node.childForFieldName('condition');
	const line = node.startPosition.row + 1;

	descriptionMap.set(line, { description: `if (${condNode?.text ?? ''})` });

	// Step for the condition evaluation
	if (consequence) {
		instrumentBlock(consequence, insertions, replacements, line, descriptionMap);
	}

	if (alternative) {
		// else clause — its child is the actual statement/block
		const elseLine = alternative.startPosition.row + 1;
		descriptionMap.set(elseLine, { description: 'else' });
		if (alternative.type === 'else_clause') {
			const elseBody = alternative.child(alternative.childCount - 1);
			if (elseBody) {
				if (elseBody.type === 'if_statement') {
					// else if — recurse
					instrumentIf(elseBody, insertions, replacements, descriptionMap);
				} else {
					instrumentBlock(elseBody, insertions, replacements, alternative.startPosition.row + 1, descriptionMap);
				}
			}
		}
	}
}

/**
 * Instrument a switch statement.
 */
function instrumentSwitch(
	node: SyntaxNode,
	insertions: Insertion[],
	replacements: Replacement[],
	descriptionMap: Map<number, StepDescription>,
): void {
	const body = node.childForFieldName('body');
	if (!body) return;

	// Recurse into case statements
	for (let i = 0; i < body.childCount; i++) {
		const child = body.child(i)!;
		if (child.type === 'case_statement') {
			const line = child.startPosition.row + 1;
			const caseLabel = child.text.split(':')[0].trim();
			descriptionMap.set(line, { description: caseLabel });
			// Find the first statement after the case label
			for (let j = 0; j < child.childCount; j++) {
				const stmt = child.child(j)!;
				if (stmt.type !== 'case_statement' && stmt.text !== ':' && !stmt.text.startsWith('case') && !stmt.text.startsWith('default')) {
					walkNode(stmt, insertions, replacements, descriptionMap);
				}
			}
			// Add step after case label
			const colon = child.children.find(c => c.text === ':');
			if (colon) {
				insertions.push({
					offset: colon.endIndex,
					text: `\n\t__crow_step(${line});`,
					priority: 5,
				});
			}
		}
	}
}

/**
 * Instrument a block (compound_statement) or single statement.
 */
function instrumentBlock(
	node: SyntaxNode,
	insertions: Insertion[],
	replacements: Replacement[],
	line: number,
	descriptionMap: Map<number, StepDescription>,
): void {
	if (node.type === 'compound_statement') {
		const openBrace = node.child(0);
		if (openBrace && openBrace.text === '{') {
			insertions.push({
				offset: openBrace.endIndex,
				text: `\n\t__crow_step(${line});`,
				priority: 8,
			});
		}
		for (let i = 1; i < node.childCount - 1; i++) {
			walkNode(node.child(i)!, insertions, replacements, descriptionMap);
		}
	} else {
		walkNode(node, insertions, replacements, descriptionMap);
	}
}

// === Call rewriting (malloc, free, scanf) ===

/**
 * Recursively search a node tree for call_expression nodes that need rewriting
 * (e.g., malloc/free/scanf inside cast expressions or nested expressions).
 */
function findAndRewriteCalls(node: SyntaxNode, replacements: Replacement[]): void {
	if (node.type === 'call_expression') {
		rewriteCallIfNeeded(node, replacements);
		return;
	}
	for (let i = 0; i < node.childCount; i++) {
		findAndRewriteCalls(node.child(i)!, replacements);
	}
}

function rewriteCallIfNeeded(callNode: SyntaxNode, replacements: Replacement[]): void {
	const funcNode = callNode.childForFieldName('function');
	if (!funcNode) return;

	const funcName = funcNode.text;

	switch (funcName) {
		case 'malloc':
		case 'calloc':
		case 'realloc':
			rewriteAllocCall(callNode, funcNode, funcName, replacements);
			break;
		case 'free':
			rewriteFreeCall(callNode, funcNode, replacements);
			break;
		case 'scanf':
			rewriteScanfCall(callNode, replacements);
			break;
		case 'strcpy':
			rewriteStrcpyCall(callNode, funcNode, replacements);
			break;
	}
}

function rewriteAllocCall(
	callNode: SyntaxNode,
	funcNode: SyntaxNode,
	funcName: string,
	replacements: Replacement[],
): void {
	const args = callNode.childForFieldName('arguments');
	if (!args) return;

	const line = callNode.startPosition.row + 1;
	const argText = args.text.slice(1, -1); // strip parentheses

	const crowName = `__crow_${funcName}`;
	let newArgs: string;

	if (funcName === 'malloc') {
		newArgs = `(${argText}, ${line})`;
	} else if (funcName === 'calloc') {
		newArgs = `(${argText}, ${line})`;
	} else {
		// realloc
		newArgs = `(${argText}, ${line})`;
	}

	replacements.push({
		startOffset: funcNode.startIndex,
		endOffset: args.endIndex,
		text: `${crowName}${newArgs}`,
	});
}

function rewriteFreeCall(
	callNode: SyntaxNode,
	funcNode: SyntaxNode,
	replacements: Replacement[],
): void {
	const args = callNode.childForFieldName('arguments');
	if (!args) return;

	const line = callNode.startPosition.row + 1;
	const argText = args.text.slice(1, -1);

	replacements.push({
		startOffset: funcNode.startIndex,
		endOffset: args.endIndex,
		text: `__crow_free(${argText}, ${line})`,
	});
}

function rewriteStrcpyCall(
	callNode: SyntaxNode,
	funcNode: SyntaxNode,
	replacements: Replacement[],
): void {
	const args = callNode.childForFieldName('arguments');
	if (!args) return;

	const line = callNode.startPosition.row + 1;
	const argText = args.text.slice(1, -1);

	replacements.push({
		startOffset: funcNode.startIndex,
		endOffset: args.endIndex,
		text: `__crow_strcpy(${argText}, ${line})`,
	});
}

function rewriteScanfCall(
	callNode: SyntaxNode,
	replacements: Replacement[],
): void {
	const args = callNode.childForFieldName('arguments');
	if (!args) return;

	const line = callNode.startPosition.row + 1;

	// Parse the format string
	const argList = extractArgList(args);
	if (argList.length < 2) return;

	const formatStr = argList[0].trim();
	// Strip quotes
	const format = formatStr.slice(1, -1);
	const specifiers = parseFormatSpecifiers(format);

	if (specifiers.length === 0) return;

	// Build replacement: one __crow_scanf_* call per specifier
	const calls: string[] = [];
	for (let i = 0; i < specifiers.length; i++) {
		const arg = argList[i + 1]?.trim();
		if (!arg) break;

		const variant = scanfVariant(specifiers[i]);
		if (variant) {
			calls.push(`${variant}(${arg}, ${line})`);
		}
	}

	if (calls.length > 0) {
		replacements.push({
			startOffset: callNode.startIndex,
			endOffset: callNode.endIndex,
			text: calls.join(';\n\t'),
		});
	}
}

function scanfVariant(specifier: string): string | null {
	switch (specifier) {
		case 'd': case 'i': case 'u': case 'x': case 'o':
			return '__crow_scanf_int';
		case 'f':
			return '__crow_scanf_float';
		case 'lf':
			return '__crow_scanf_double';
		case 'c':
			return '__crow_scanf_char';
		case 's':
			return '__crow_scanf_string';
		default:
			return null;
	}
}

function parseFormatSpecifiers(format: string): string[] {
	const specifiers: string[] = [];
	const re = /%(\*?)(\d*)(l?)([diouxXfFeEgGscpn%])/g;
	let match;
	while ((match = re.exec(format)) !== null) {
		if (match[1] === '*') continue; // skip suppressed
		if (match[4] === '%') continue; // literal %
		const length = match[3];
		const spec = match[4];
		specifiers.push(length + spec);
	}
	return specifiers;
}

function extractArgList(argsNode: SyntaxNode): string[] {
	// Arguments is '(' arg (',' arg)* ')'
	const args: string[] = [];
	let depth = 0;
	let current = '';

	const text = argsNode.text;
	// Skip opening paren
	for (let i = 1; i < text.length - 1; i++) {
		const ch = text[i];
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (ch === ',' && depth === 0) {
			args.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	if (current.trim()) args.push(current);
	return args;
}

// === Helpers ===

// === Struct registry extraction ===

function extractStructDefinitions(rootNode: SyntaxNode): StructRegistry {
	const registry: StructRegistry = new Map();
	walkForStructs(rootNode, registry);
	return registry;
}

function walkForStructs(node: SyntaxNode, registry: StructRegistry): void {
	if (node.type === 'struct_specifier') {
		const nameNode = node.childForFieldName('name');
		const body = node.childForFieldName('body');
		if (nameNode && body) {
			const fields: StructField[] = [];
			for (let i = 0; i < body.childCount; i++) {
				const child = body.child(i)!;
				if (child.type === 'field_declaration') {
					const typeNode = child.childForFieldName('type');
					let typeStr = typeNode?.text ?? 'int';
					// Check for struct specifier in field type
					for (let j = 0; j < child.childCount; j++) {
						const fc = child.child(j)!;
						if (fc.type === 'struct_specifier') {
							typeStr = `struct ${fc.childForFieldName('name')?.text ?? ''}`;
							break;
						}
					}
					const declarator = child.childForFieldName('declarator');
					if (declarator) {
						const info = parseDeclName(declarator);
						fields.push({ name: info.name, type: escapeType(typeStr, info) });
					}
				}
			}
			registry.set(nameNode.text, fields);
		}
	}
	for (let i = 0; i < node.childCount; i++) {
		walkForStructs(node.child(i)!, registry);
	}
}

function isInFunctionBody(node: SyntaxNode): boolean {
	let parent = node.parent;
	while (parent) {
		if (parent.type === 'function_definition') return true;
		parent = parent.parent;
	}
	return false;
}

function extractFunctionName(declarator: SyntaxNode): string {
	// Walk through pointer_declarator wrappers
	let node = declarator;
	while (node.type === 'pointer_declarator' || node.type === 'parenthesized_declarator') {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)!;
			if (child.type !== '*' && child.type !== '(' && child.type !== ')') {
				node = child;
				break;
			}
		}
	}
	if (node.type === 'function_declarator') {
		const nameNode = node.childForFieldName('declarator');
		return nameNode?.text ?? 'unknown';
	}
	return node.text ?? 'unknown';
}

type ParamInfo = { name: string; type: string };

function extractParameters(declarator: SyntaxNode): ParamInfo[] {
	// Find the function_declarator
	let funcDecl = declarator;
	while (funcDecl.type !== 'function_declarator' && funcDecl.childCount > 0) {
		for (let i = 0; i < funcDecl.childCount; i++) {
			const child = funcDecl.child(i)!;
			if (child.type === 'function_declarator') {
				funcDecl = child;
				break;
			}
			if (i === funcDecl.childCount - 1) return [];
		}
		if (funcDecl.type !== 'function_declarator') break;
	}
	if (funcDecl.type !== 'function_declarator') return [];

	const paramList = funcDecl.childForFieldName('parameters');
	if (!paramList) return [];

	const params: ParamInfo[] = [];
	for (let i = 0; i < paramList.childCount; i++) {
		const param = paramList.child(i)!;
		if (param.type === 'parameter_declaration') {
			const typeStr = extractParamType(param);
			const name = extractParamName(param);
			if (name && name !== 'void' && typeStr !== 'void') {
				params.push({ name, type: typeStr });
			}
		}
	}
	return params;
}

function extractParamType(param: SyntaxNode): string {
	const typeNode = param.childForFieldName('type');
	let type = typeNode?.text ?? 'int';
	// Check if declarator is a pointer (e.g., int *p → "int*")
	const declarator = param.childForFieldName('declarator');
	if (declarator) {
		let node = declarator;
		while (node.type === 'pointer_declarator') {
			type += '*';
			for (let i = 0; i < node.childCount; i++) {
				const child = node.child(i)!;
				if (child.type !== '*') {
					node = child;
					break;
				}
			}
		}
	}
	return type;
}

function extractParamName(param: SyntaxNode): string | null {
	const declarator = param.childForFieldName('declarator');
	if (!declarator) return null;
	// Unwrap pointer declarators
	let node = declarator;
	while (node.type === 'pointer_declarator') {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)!;
			if (child.type !== '*') {
				node = child;
				break;
			}
		}
	}
	if (node.type === 'array_declarator') {
		const inner = node.child(0);
		return inner?.text ?? null;
	}
	return node.text;
}

function getDeclarationType(node: SyntaxNode): string | null {
	// Check for struct specifier
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i)!;
		if (child.type === 'struct_specifier') {
			return `struct ${child.childForFieldName('name')?.text ?? ''}`;
		}
		if (child.type === 'primitive_type' || child.type === 'sized_type_specifier' || child.type === 'type_identifier') {
			return child.text;
		}
	}
	// Type qualifiers like const, unsigned
	const typeNode = node.childForFieldName('type');
	return typeNode?.text ?? null;
}

type DeclInfo = { name: string; isPointer: boolean; arraySize: string | null; hasInitializer: boolean };

function getDeclarators(node: SyntaxNode): DeclInfo[] {
	const decls: DeclInfo[] = [];

	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i)!;
		if (child.type === 'init_declarator') {
			const declarator = child.childForFieldName('declarator');
			if (declarator) {
				decls.push({ ...parseDeclName(declarator), hasInitializer: true });
			}
		} else if (child.type === 'identifier') {
			decls.push({ name: child.text, isPointer: false, arraySize: null, hasInitializer: false });
		} else if (child.type === 'pointer_declarator' || child.type === 'array_declarator') {
			decls.push({ ...parseDeclName(child), hasInitializer: false });
		}
	}

	return decls;
}

function parseDeclName(node: SyntaxNode): DeclInfo {
	let isPointer = false;
	let arraySize: string | null = null;
	let current = node;

	while (true) {
		if (current.type === 'pointer_declarator') {
			isPointer = true;
			for (let i = 0; i < current.childCount; i++) {
				const child = current.child(i)!;
				if (child.type !== '*') {
					current = child;
					break;
				}
			}
		} else if (current.type === 'array_declarator') {
			// Extract array size — accumulate dimensions for 2D+ arrays
			const sizeNode = current.child(2); // identifier [ SIZE ]
			if (sizeNode && sizeNode.text !== ']') {
				arraySize = arraySize ? `${arraySize}][${sizeNode.text}` : sizeNode.text;
			}
			current = current.child(0)!;
		} else if (current.type === 'function_declarator') {
			// Function pointer: (*fp)(int, int)
			isPointer = true;
			const inner = current.childForFieldName('declarator');
			if (inner) {
				current = inner;
			} else {
				break;
			}
		} else if (current.type === 'parenthesized_declarator') {
			// Unwrap: (*fp) → pointer_declarator → fp
			let found = false;
			for (let i = 0; i < current.childCount; i++) {
				const child = current.child(i)!;
				if (child.type !== '(' && child.type !== ')') {
					current = child;
					found = true;
					break;
				}
			}
			if (!found) break;
		} else {
			break;
		}
	}

	return { name: current.text, isPointer, arraySize, hasInitializer: false };
}

function escapeType(baseType: string, decl: DeclInfo): string {
	let type = baseType;
	if (decl.isPointer) type += '*';
	if (decl.arraySize) type += `[${decl.arraySize}]`;
	return type;
}

/**
 * Find identifiers that are dereferenced via * or [] in an expression tree.
 * Used to emit __crow_set for pointer vars read through dereference,
 * enabling use-after-free detection on reads like `int x = *p;`.
 */
function findPointerDerefsInNode(node: SyntaxNode): string[] {
	const names: string[] = [];
	walkForPointerDerefs(node, names);
	return [...new Set(names)]; // deduplicate
}

function walkForPointerDerefs(node: SyntaxNode, names: string[]): void {
	if (node.type === 'pointer_expression') {
		// *p or &p — only care about dereference (*)
		const op = node.child(0);
		if (op?.text === '*') {
			const arg = node.child(1);
			if (arg?.type === 'identifier') {
				names.push(arg.text);
			}
		}
		return; // don't recurse into children — we found the deref
	}
	if (node.type === 'subscript_expression') {
		// p[i] — equivalent to *(p+i), the array base is being dereferenced
		const obj = node.childForFieldName('argument') ?? node.child(0);
		if (obj?.type === 'identifier') {
			names.push(obj.text);
		}
		return;
	}
	for (let i = 0; i < node.childCount; i++) {
		walkForPointerDerefs(node.child(i)!, names);
	}
}

function collectChainedTargets(expr: SyntaxNode): { name: string; addrExpr: string }[] {
	const targets: { name: string; addrExpr: string }[] = [];
	const lhs = expr.childForFieldName('left');
	const target = extractSetTarget(lhs);
	if (target) targets.push(target);

	const rhs = expr.childForFieldName('right');
	if (rhs && rhs.type === 'assignment_expression') {
		targets.push(...collectChainedTargets(rhs));
	}
	return targets;
}

function extractSetTarget(node: SyntaxNode | null): { name: string; addrExpr: string } | null {
	if (!node) return null;

	if (node.type === 'identifier') {
		return { name: node.text, addrExpr: `&${node.text}` };
	}

	if (node.type === 'subscript_expression') {
		// arr[i] = ... → track the array
		const obj = node.childForFieldName('argument') ?? node.child(0);
		if (obj) {
			// If the base is a field expression (e.g., p->scores[i]),
			// walk to the root variable so onSet can update the struct
			if (obj.type === 'field_expression') {
				const root = extractFieldRoot(obj);
				if (root) {
					return { name: root, addrExpr: `&${root}` };
				}
			}
			const name = obj.text;
			return { name, addrExpr: `&${name}` };
		}
	}

	if (node.type === 'field_expression') {
		// p.x = ..., p->x = ..., or p->pos.x = ... → walk to the root variable
		const root = extractFieldRoot(node);
		if (root) {
			return { name: root, addrExpr: `&${root}` };
		}
	}

	if (node.type === 'pointer_expression') {
		// *p = ... → track p
		const operand = node.child(1);
		if (operand) {
			return { name: operand.text, addrExpr: `&${operand.text}` };
		}
	}

	return null;
}

/**
 * Walk a field_expression chain to find the root variable name.
 * e.g., player->pos.x → "player", p.x → "p"
 */
function extractFieldRoot(node: SyntaxNode): string | null {
	let current = node;
	while (current.type === 'field_expression') {
		const obj = current.childForFieldName('argument') ?? current.child(0);
		if (!obj) return null;
		current = obj;
	}
	if (current.type === 'identifier') {
		return current.text;
	}
	return null;
}

function bodyHasTrailingReturn(body: SyntaxNode): boolean {
	// Check if the last statement in the body is a return
	for (let i = body.childCount - 1; i >= 0; i--) {
		const child = body.child(i)!;
		if (child.type === '}') continue;
		if (child.type === 'return_statement') return true;
		return false;
	}
	return false;
}

// === Text transformation application ===

/**
 * Apply replacements first (in reverse order to preserve offsets).
 */
function applyReplacements(source: string, replacements: Replacement[]): string {
	// Sort by startOffset descending
	const sorted = [...replacements].sort((a, b) => b.startOffset - a.startOffset);

	let result = source;
	for (const r of sorted) {
		result = result.slice(0, r.startOffset) + r.text + result.slice(r.endOffset);
	}
	return result;
}

/**
 * Apply insertions (in reverse order to preserve offsets).
 * Offsets are adjusted for any replacements that happened before them.
 */
function applyInsertions(
	source: string,
	insertions: Insertion[],
	replacements: Replacement[],
): string {
	// Adjust insertion offsets for replacements
	const adjustedInsertions = insertions.map(ins => {
		let offset = ins.offset;
		for (const r of replacements) {
			if (r.startOffset < ins.offset) {
				const origLen = r.endOffset - r.startOffset;
				const newLen = r.text.length;
				if (ins.offset >= r.endOffset) {
					offset += newLen - origLen;
				} else if (ins.offset > r.startOffset) {
					// Inside a replacement — shift to end
					offset = r.startOffset + newLen;
				}
			}
		}
		return { ...ins, offset };
	});

	// Sort by offset descending, then by priority descending
	const sorted = adjustedInsertions.sort((a, b) => {
		if (a.offset !== b.offset) return b.offset - a.offset;
		return b.priority - a.priority;
	});

	let result = source;
	for (const ins of sorted) {
		result = result.slice(0, ins.offset) + ins.text + result.slice(ins.offset);
	}
	return result;
}
