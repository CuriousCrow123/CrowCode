// === C Type Representation ===

export type CType =
	| { kind: 'primitive'; name: 'int' | 'char' | 'short' | 'long' | 'float' | 'double' | 'void' }
	| { kind: 'pointer'; pointsTo: CType }
	| { kind: 'array'; elementType: CType; size: number }
	| { kind: 'struct'; name: string; fields: Array<{ name: string; type: CType; offset: number }> }
	| { kind: 'function'; returnType: CType; paramTypes: CType[] };

// === Runtime Value ===

export type CValue = {
	type: CType;
	data: number | null;
	address: number;
	initialized?: boolean;
	stringValue?: string;
};

// === Child Specification (for emitter) ===

export type ChildSpec = {
	name: string;
	displayName: string;
	type: CType;
	value: string;
	addressOffset: number;
	children?: ChildSpec[];
};

// === Parameter Specification ===

export type ParamSpec = {
	name: string;
	type: CType;
	value: string;
	address?: number;
	children?: ChildSpec[];
};

// === Interpreter Scope ===

export type Scope = {
	name: string;
	symbols: Map<string, CValue>;
	parent: Scope | null;
};

// === Heap Block ===

export type HeapBlock = {
	address: number;
	size: number;
	type: CType;
	status: 'allocated' | 'freed' | 'leaked';
	allocator: string;
	allocSite: { line: number };
};

// === Interpreter Options ===

export type InterpreterOptions = {
	maxSteps?: number;
	maxFrames?: number;
	maxHeapBytes?: number;
	stdin?: string;
};

// === AST Node Types ===

export type ASTNode =
	| { type: 'translation_unit'; children: ASTNode[] }
	| { type: 'function_definition'; returnType: CTypeSpec; name: string; params: ASTParam[]; body: ASTNode; line: number }
	| { type: 'struct_definition'; name: string; fields: ASTStructField[]; line: number }
	| { type: 'declaration'; declType: CTypeSpec; name: string; initializer?: ASTNode; line: number }
	| { type: 'assignment'; target: ASTNode; operator: string; value: ASTNode; line: number }
	| { type: 'return_statement'; value?: ASTNode; line: number }
	| { type: 'expression_statement'; expression: ASTNode; line: number }
	| { type: 'compound_statement'; children: ASTNode[]; line: number }
	| { type: 'if_statement'; condition: ASTNode; consequent: ASTNode; alternate?: ASTNode; line: number }
	| { type: 'for_statement'; init?: ASTNode; condition?: ASTNode; update?: ASTNode; body: ASTNode; line: number; condColStart?: number; condColEnd?: number; updateColStart?: number; updateColEnd?: number }
	| { type: 'while_statement'; condition: ASTNode; body: ASTNode; line: number }
	| { type: 'do_while_statement'; body: ASTNode; condition: ASTNode; line: number }
	| { type: 'binary_expression'; operator: string; left: ASTNode; right: ASTNode; line: number }
	| { type: 'unary_expression'; operator: string; operand: ASTNode; prefix: boolean; line: number }
	| { type: 'call_expression'; callee: string; args: ASTNode[]; line: number; colStart?: number; colEnd?: number }
	| { type: 'member_expression'; object: ASTNode; field: string; arrow: boolean; line: number }
	| { type: 'subscript_expression'; object: ASTNode; index: ASTNode; line: number }
	| { type: 'cast_expression'; targetType: CTypeSpec; value: ASTNode; line: number }
	| { type: 'sizeof_expression'; targetType: CTypeSpec; line: number }
	| { type: 'sizeof_expr'; value: ASTNode; line: number }
	| { type: 'number_literal'; value: number; isFloat?: boolean; line: number }
	| { type: 'string_literal'; value: string; line: number }
	| { type: 'char_literal'; value: number; line: number }
	| { type: 'identifier'; name: string; line: number }
	| { type: 'comma_expression'; expressions: ASTNode[]; line: number }
	| { type: 'conditional_expression'; condition: ASTNode; consequent: ASTNode; alternate: ASTNode; line: number }
	| { type: 'init_list'; values: ASTNode[]; line: number }
	| { type: 'null_literal'; line: number }
	| { type: 'switch_statement'; expression: ASTNode; cases: ASTCaseClause[]; line: number }
	| { type: 'break_statement'; line: number }
	| { type: 'continue_statement'; line: number }
	| { type: 'preproc_include'; line: number };

export type ASTCaseClause = {
	kind: 'case' | 'default';
	value?: ASTNode;
	statements: ASTNode[];
	line: number;
};

export type CTypeSpec = {
	base: string;
	pointer: number;
	array?: number;
	arrays?: number[];
	structName?: string;
	functionParams?: CTypeSpec[];
};

export type ASTParam = {
	name: string;
	typeSpec: CTypeSpec;
};

export type ASTStructField = {
	name: string;
	typeSpec: CTypeSpec;
};
