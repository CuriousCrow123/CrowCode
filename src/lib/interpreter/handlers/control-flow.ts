import type { ASTNode } from '../types';
import type { HandlerContext } from './types';
import { typeToString } from '../types-c';

export function executeIf(ctx: HandlerContext, node: ASTNode & { type: 'if_statement' }): void {
	const condResult = ctx.evaluator.eval(node.condition);
	if (condResult.error) {
		ctx.errors.push(condResult.error);
		return;
	}

	const taken = (condResult.value.data ?? 0) !== 0;
	const condText = ctx.describeExpr(node.condition);

	ctx.memory.beginStep(
		{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
		`if: ${condText} → ${taken ? 'true' : 'false'}`,
	);
	ctx.stepCount++;

	if (taken) {
		ctx.dispatch(node.consequent);
	} else if (node.alternate) {
		ctx.dispatch(node.alternate);
	}
}

export function executeFor(ctx: HandlerContext, node: ASTNode & { type: 'for_statement' }): void {
	const hasDecl = node.init?.type === 'declaration';

	if (node.init) {
		ctx.memory.beginStep({ line: node.line }, `for: ${describeForInit(ctx, node.init)}`);
		ctx.stepCount++;

		if (hasDecl) {
			ctx.memory.pushScopeRuntime('for');
			ctx.memory.pushBlock('for');
		}

		ctx.dispatch(node.init, true);
		if (!hasDecl) {
			ctx.memory.pushScopeRuntime('for');
			ctx.memory.pushBlock('for');
		}
	} else {
		ctx.memory.beginStep({ line: node.line }, 'for: init');
		ctx.stepCount++;
		ctx.memory.pushScopeRuntime('for');
		ctx.memory.pushBlock('for');
	}

	let iteration = 0;
	while (iteration < ctx.maxSteps) {
		if (ctx.stepCount >= ctx.maxSteps) {
			ctx.errors.push(`Step limit exceeded (${ctx.maxSteps})`);
			break;
		}

		if (node.condition) {
			const condResult = ctx.evaluator.eval(node.condition);
			if (condResult.error) {
				ctx.errors.push(condResult.error);
				break;
			}

			const condVal = condResult.value.data ?? 0;

			if (condVal === 0) {
				const condText = ctx.describeExpr(node.condition);
				ctx.memory.beginStep(
					{ line: node.line, colStart: node.condColStart, colEnd: node.condColEnd },
					`for: check ${condText} → false, exit loop`,
					`${condText} → false`,
				);
				ctx.stepCount++;
				break;
			}

			const condText = ctx.describeExpr(node.condition);
			ctx.memory.beginStep(
				{ line: node.line, colStart: node.condColStart, colEnd: node.condColEnd },
				`for: check ${condText} → true`,
				`${condText} → true`,
			);
			ctx.memory.markSubStep();
			ctx.stepCount++;
		}

		ctx.dispatch(node.body);

		if (ctx.breakFlag) {
			ctx.breakFlag = false;
			break;
		}
		if (ctx.continueFlag) {
			ctx.continueFlag = false;
		}
		if (ctx.returnFlag) break;

		if (node.update) {
			const beforeVal = describeUpdateBefore(ctx, node.update);
			const result = ctx.evaluator.eval(node.update);
			if (result.error) ctx.errors.push(result.error);

			let afterVal = result.value.data ?? 0;
			let varName: string | undefined;
			if (node.update.type === 'unary_expression' && node.update.operand.type === 'identifier') {
				varName = node.update.operand.name;
			} else if (node.update.type === 'assignment' && node.update.target.type === 'identifier') {
				varName = node.update.target.name;
			}
			if (varName) {
				const current = ctx.memory.lookupVariable(varName);
				if (current) afterVal = current.data ?? afterVal;
			}

			ctx.memory.beginStep(
				{ line: node.line, colStart: node.updateColStart, colEnd: node.updateColEnd },
				`for: ${beforeVal} → ${describeUpdateResult(node.update, afterVal)}`,
			);
			ctx.memory.markSubStep();
			ctx.stepCount++;

			if (varName) {
				ctx.memory.assignVariable(varName, String(afterVal));
			}
		}

		iteration++;
	}

	// Exit block
	ctx.memory.popBlock();
	ctx.memory.popScopeRuntime();
}

export function executeWhile(ctx: HandlerContext, node: ASTNode & { type: 'while_statement' }): void {
	let iteration = 0;
	const hasDecls = bodyHasDeclarations(node.body);
	const condText = ctx.describeExpr(node.condition);

	if (hasDecls) {
		ctx.memory.beginStep({ line: node.line }, 'Enter while loop');
		ctx.stepCount++;
		ctx.memory.pushScopeRuntime('while');
		ctx.memory.pushBlock('while');
	}

	while (iteration < ctx.maxSteps) {
		if (ctx.stepCount >= ctx.maxSteps) {
			ctx.errors.push(`Step limit exceeded (${ctx.maxSteps})`);
			break;
		}

		const condResult = ctx.evaluator.eval(node.condition);
		if (condResult.error) {
			ctx.errors.push(condResult.error);
			break;
		}

		if ((condResult.value.data ?? 0) === 0) {
			ctx.memory.beginStep(
				{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
				`while: ${condText} → false, exit`,
			);
			ctx.stepCount++;
			break;
		}

		ctx.memory.beginStep(
			{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
			`while: check ${condText} → true`,
		);
		ctx.memory.markSubStep();
		ctx.stepCount++;

		if (node.body.type === 'compound_statement') {
			ctx.dispatchStatements(node.body.children);
		} else {
			ctx.dispatch(node.body);
		}

		if (ctx.breakFlag) { ctx.breakFlag = false; break; }
		if (ctx.continueFlag) { ctx.continueFlag = false; }
		if (ctx.returnFlag) break;

		iteration++;
	}

	if (hasDecls) {
		ctx.memory.popBlock();
		ctx.memory.popScopeRuntime();
	}
}

export function executeDoWhile(ctx: HandlerContext, node: ASTNode & { type: 'do_while_statement' }): void {
	let iteration = 0;
	const hasDecls = bodyHasDeclarations(node.body);
	const condText = ctx.describeExpr(node.condition);

	if (hasDecls) {
		ctx.memory.beginStep({ line: node.line }, 'Enter do-while loop');
		ctx.stepCount++;
		ctx.memory.pushScopeRuntime('do-while');
		ctx.memory.pushBlock('do-while');
	}

	do {
		if (ctx.stepCount >= ctx.maxSteps) {
			ctx.errors.push(`Step limit exceeded (${ctx.maxSteps})`);
			break;
		}

		if (node.body.type === 'compound_statement') {
			ctx.dispatchStatements(node.body.children);
		} else {
			ctx.dispatch(node.body);
		}

		if (ctx.breakFlag) { ctx.breakFlag = false; break; }
		if (ctx.continueFlag) { ctx.continueFlag = false; }
		if (ctx.returnFlag) break;

		const condResult = ctx.evaluator.eval(node.condition);
		if (condResult.error) {
			ctx.errors.push(condResult.error);
			break;
		}

		if ((condResult.value.data ?? 0) === 0) {
			ctx.memory.beginStep(
				{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
				`do-while: ${condText} → false, exit`,
			);
			ctx.stepCount++;
			break;
		}

		ctx.memory.beginStep(
			{ line: node.line, colStart: (node as any).condColStart, colEnd: (node as any).condColEnd },
			`do-while: check ${condText} → true`,
		);
		ctx.memory.markSubStep();
		ctx.stepCount++;

		iteration++;
	} while (iteration < ctx.maxSteps);

	if (hasDecls) {
		ctx.memory.popBlock();
		ctx.memory.popScopeRuntime();
	}
}

export function executeSwitch(ctx: HandlerContext, node: ASTNode & { type: 'switch_statement' }): void {
	const condResult = ctx.evaluator.eval(node.expression);
	if (condResult.error) {
		ctx.errors.push(condResult.error);
		return;
	}

	const switchValue = condResult.value.data ?? 0;
	const condText = ctx.describeExpr(node.expression);

	ctx.memory.beginStep({ line: node.line }, `switch: ${condText} = ${switchValue}`);
	ctx.stepCount++;

	let matchIndex = -1;
	let defaultIndex = -1;
	for (let i = 0; i < node.cases.length; i++) {
		const clause = node.cases[i];
		if (clause.kind === 'default') {
			defaultIndex = i;
		} else if (clause.value) {
			const caseResult = ctx.evaluator.eval(clause.value);
			if (!caseResult.error && (caseResult.value.data ?? 0) === switchValue) {
				matchIndex = i;
				break;
			}
		}
	}

	const startIndex = matchIndex >= 0 ? matchIndex : defaultIndex;
	if (startIndex < 0) return;

	const savedBreak = ctx.breakFlag;
	ctx.breakFlag = false;

	for (let i = startIndex; i < node.cases.length; i++) {
		const clause = node.cases[i];
		ctx.dispatchStatements(clause.statements);

		if (ctx.breakFlag) {
			ctx.breakFlag = false;
			break;
		}
		if (ctx.returnFlag || ctx.continueFlag) break;
		if (ctx.stepCount >= ctx.maxSteps) break;
	}

	ctx.breakFlag = savedBreak;
}

export function executeBlock(ctx: HandlerContext, node: ASTNode & { type: 'compound_statement' }): void {
	const hasDecls = node.children.some((c) => c.type === 'declaration');

	if (hasDecls) {
		ctx.memory.beginStep({ line: node.line }, 'Enter block scope');
		ctx.stepCount++;
		ctx.memory.pushScopeRuntime('block');
		ctx.memory.pushBlock('{ }');
	}

	ctx.dispatchStatements(node.children);

	if (hasDecls) {
		ctx.memory.beginStep(
			{ line: findClosingLine(node) },
			'Exit block scope',
		);
		ctx.stepCount++;
		ctx.memory.popBlock();
		ctx.memory.popScopeRuntime();
	}
}

export function describeForInit(ctx: HandlerContext, node: ASTNode): string {
	if (node.type === 'declaration') {
		return `${typeToString(ctx.typeReg.resolve(node.declType))} ${node.name} = ${node.initializer ? ctx.describeExpr(node.initializer) : '0'}`;
	}
	return ctx.describeExpr(node);
}

export function describeUpdateBefore(ctx: HandlerContext, node: ASTNode): string {
	if (node.type === 'unary_expression' && node.operand.type === 'identifier') {
		return `${node.operand.name}${node.operator}`;
	}
	return ctx.describeExpr(node);
}

export function describeUpdateResult(node: ASTNode, value: number): string {
	if (node.type === 'unary_expression' && node.operand.type === 'identifier') {
		return `${node.operand.name} = ${value}`;
	}
	return String(value);
}

export function bodyHasDeclarations(body: ASTNode): boolean {
	if (body.type === 'compound_statement') {
		return body.children.some((c) => c.type === 'declaration');
	}
	return false;
}

function findClosingLine(node: ASTNode): number {
	if (node.type === 'compound_statement' && node.children.length > 0) {
		return getLine(node.children[node.children.length - 1]) + 1;
	}
	return getLine(node);
}

function getLine(node: ASTNode): number {
	if ('line' in node) return node.line as number;
	return 1;
}
