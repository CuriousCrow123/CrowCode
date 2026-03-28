import type { ASTNode, CType, CValue, ChildSpec } from '../types';
import type { Memory } from '../memory';
import type { Evaluator } from '../evaluator';
import type { TypeRegistry } from '../types-c';
import type { IoState } from '../io-state';

/** Shared context passed to all handler functions. */
export type HandlerContext = {
	readonly memory: Memory;
	readonly evaluator: Evaluator;
	readonly typeReg: TypeRegistry;
	readonly io: IoState;
	readonly errors: string[];
	readonly maxSteps: number;
	readonly maxFrames: number;
	readonly interactive: boolean;
	stepCount: number;
	frameDepth: number;
	breakFlag: boolean;
	continueFlag: boolean;
	returnFlag: boolean;
	returnValue: CValue | null;
	/**
	 * Set by input handlers (scanf, getchar, fgets, gets) when stdin is exhausted.
	 * Unlike breakFlag/continueFlag/returnFlag which stop execution permanently,
	 * needsInput causes the generator to yield and resume after new input is provided.
	 * The generator must reset this to false after each yield.
	 */
	needsInput: boolean;
	/** Active function-call context: which variable receives the return value, and column ranges for highlighting. */
	callContext: { varName: string; colStart?: number; colEnd?: number } | null;

	/** Dispatch a single statement (generator — use yield* to delegate). */
	dispatch(node: ASTNode, sharesStep?: boolean): Generator<void, void, void>;
	/** Dispatch multiple statements (generator — use yield* to delegate). */
	dispatchStatements(statements: ASTNode[], firstSharesStep?: boolean): Generator<void, void, void>;
	/** Call a user-defined function (generator — use yield* to delegate). */
	callFunction(fn: ASTNode & { type: 'function_definition' }, args: CValue[], line: number): Generator<void, { value: CValue; error?: string }, void>;
	/** Format a value for display. */
	formatValue(type: CType, data: number | null, initialized?: boolean): string;
	/** Describe an AST expression for step descriptions. */
	describeExpr(node: ASTNode): string;
};
