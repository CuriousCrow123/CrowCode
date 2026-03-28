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

/** Yielded by the interactive generator when the program needs stdin input. */
export type NeedInputSignal = {
	type: 'need_input';
	program: Program;
};

/** Generator type for interactive interpretation. */
export type InteractiveGenerator = Generator<NeedInputSignal, InterpretResult, string>;

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

/**
 * Interactive interpretation — returns a generator that yields when stdin is needed.
 * Call gen.next() to start, gen.next(input) to provide input after a yield.
 */
export function interpretInteractive(
	parser: Parser,
	source: string,
	opts?: InterpreterOptions,
): { generator: InteractiveGenerator; parseErrors: string[] } {
	const { result: ast, errors: parseErrors } = parseSource(parser, source);
	const interp = new Interpreter(source, opts);
	return {
		generator: interp.interpretGen(ast),
		parseErrors: parseErrors.filter((e) => !e.startsWith('Warning:')),
	};
}
