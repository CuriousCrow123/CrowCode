import type { Program } from '$lib/types';
import type { InterpreterOptions, ASTNode } from './types';
import { parseSource } from './parser';
import { Interpreter } from './interpreter';
import type { Parser } from 'web-tree-sitter';

export type { InterpreterOptions } from './types';
export { resetParserCache } from './parser';

export type InterpretResult = {
	program: Program;
	errors: string[];
};

/**
 * Synchronous interpretation with a pre-initialized parser.
 * Parse C source → AST → interpret → Program.
 */
export function interpretSync(
	parser: Parser,
	source: string,
	opts?: InterpreterOptions,
): InterpretResult {
	const { result: ast, errors: parseErrors } = parseSource(parser, source);

	const interp = new Interpreter(source, opts);
	const interpResult = interp.interpretAST(ast);

	return {
		program: interpResult.program,
		errors: [
			...parseErrors.filter((e) => !e.startsWith('Warning:')),
			...interpResult.errors,
		],
	};
}
