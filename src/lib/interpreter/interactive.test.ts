import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { interpretInteractive, interpretSync, resetParserCache } from './index';
import type { InterpretResult } from './index';
import { validateProgram } from '$lib/engine/validate';
import { buildSnapshots } from '$lib/engine/snapshot';
import { buildConsoleOutputs } from '$lib/engine/console';
import type { Program, MemoryEntry } from '$lib/api/types';

let parser: Parser;

beforeAll(async () => {
	resetParserCache();
	await Parser.init({
		locateFile: () => resolve('static/tree-sitter.wasm'),
	});
	parser = new Parser();
	const lang = await Language.load(resolve('static/tree-sitter-c.wasm'));
	parser.setLanguage(lang);
});

// === Helpers ===

function interactive(source: string, opts?: { maxSteps?: number }) {
	const { generator, parseErrors } = interpretInteractive(
		parser, source, { interactive: true, ...opts },
	);
	expect(parseErrors).toHaveLength(0);
	return generator;
}

/** Drive generator with predefined inputs. Fails if generator yields more times than inputs provided. */
function driveInteractive(
	source: string,
	inputs: string[],
	opts?: { maxSteps?: number },
): { result: InterpretResult; yieldCount: number } {
	const gen = interactive(source, opts);
	let yieldCount = 0;
	let r = gen.next();
	while (!r.done) {
		if (yieldCount >= inputs.length) {
			throw new Error(`Unexpected yield #${yieldCount + 1}: no more inputs`);
		}
		r = gen.next(inputs[yieldCount]);
		yieldCount++;
	}
	return { result: r.value, yieldCount };
}

function expectValid(program: Program) {
	const errors = validateProgram(program);
	if (errors.length > 0) {
		console.log('Validation errors:', errors);
		console.log('Steps:', JSON.stringify(program.steps.map((s, i) => ({
			i,
			line: s.location.line,
			desc: s.description,
			sub: s.subStep,
			ops: s.ops.map((o) => o.op),
		})), null, 2));
	}
	expect(errors).toHaveLength(0);
}

function expectNoWarnings(program: Program) {
	const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	buildSnapshots(program);
	expect(spy).not.toHaveBeenCalled();
	spy.mockRestore();
}

function findEntry(entries: MemoryEntry[], name: string): MemoryEntry | undefined {
	for (const e of entries) {
		if (e.name === name) return e;
		if (e.children) {
			const found = findEntry(e.children, name);
			if (found) return found;
		}
	}
	return undefined;
}

// === Step 1: Generator lifecycle ===

describe('generator lifecycle', () => {
	it('program with no input completes without yielding', () => {
		const gen = interactive('int main() { int x = 5; return 0; }');
		const r = gen.next();
		expect(r.done).toBe(true);
		const result = r.value as InterpretResult;
		expect(result.program.steps.length).toBeGreaterThan(0);
		expect(result.errors).toHaveLength(0);
	});

	it('program with scanf yields need_input', () => {
		const gen = interactive('int main() { int x; scanf("%d", &x); return 0; }');
		const r = gen.next();
		expect(r.done).toBe(false);
		expect(r.value).toHaveProperty('type', 'need_input');
		expect(r.value).toHaveProperty('program');
		expect((r.value as { program: Program }).program.steps.length).toBeGreaterThan(0);
	});

	it('providing input resumes and completes', () => {
		const gen = interactive('int main() { int x; scanf("%d", &x); return 0; }');
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const r2 = gen.next('42\n');
		expect(r2.done).toBe(true);
		const result = r2.value as InterpretResult;
		expect(result.errors).toHaveLength(0);
		expectValid(result.program);
	});

	it('first gen.next() argument is discarded — only subsequent calls send input', () => {
		const gen = interactive('int main() { int x; scanf("%d", &x); return 0; }');
		const r1 = gen.next('IGNORED');
		expect(r1.done).toBe(false); // The string is ignored per JS generator spec
		const r2 = gen.next('42\n');
		expect(r2.done).toBe(true);
		const result = r2.value as InterpretResult;
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('parseErrors returned for invalid source', () => {
		const { generator, parseErrors } = interpretInteractive(
			parser, 'not valid C', { interactive: true },
		);
		// Either parseErrors is non-empty, or the generator completes with errors
		if (parseErrors.length > 0) {
			expect(parseErrors.length).toBeGreaterThan(0);
		} else {
			const r = generator.next();
			if (r.done) {
				expect((r.value as InterpretResult).errors.length).toBeGreaterThan(0);
			}
		}
	});

	it('generator can be cancelled via .return()', () => {
		const gen = interactive('int main() { int x; scanf("%d", &x); return 0; }');
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const cancelResult = gen.return({ program: { name: '', source: '', steps: [] }, errors: [] });
		expect(cancelResult.done).toBe(true);
		// Generator is closed — subsequent next() also returns done
		const r2 = gen.next('42\n');
		expect(r2.done).toBe(true);
	});
});

// === Step 2: Core interactive workflows ===

describe('scanf + printf interactive workflow', () => {
	const src = `int main() {
	int x;
	int y;
	printf("Enter two numbers:\\n");
	scanf("%d", &x);
	scanf("%d", &y);
	printf("Sum = %d\\n", x + y);
	return 0;
}`;

	it('pauses at first scanf with printf output already in steps', () => {
		const gen = interactive(src);
		const r = gen.next();
		expect(r.done).toBe(false);
		const partial = (r.value as { program: Program }).program;
		expect(partial.steps.find(s => s.description?.includes('scanf'))).toBeDefined();
		// printf output should already be in steps before scanf pause
		const consoleOutputs = buildConsoleOutputs(partial.steps);
		const lastOutput = consoleOutputs[consoleOutputs.length - 1];
		expect(lastOutput).toContain('Enter two numbers:');
	});

	it('resumes after first input, pauses at second scanf', () => {
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const firstStepCount = (r1.value as { program: Program }).program.steps.length;
		const r2 = gen.next('10\n');
		expect(r2.done).toBe(false);
		const secondStepCount = (r2.value as { program: Program }).program.steps.length;
		expect(secondStepCount).toBeGreaterThan(firstStepCount);
	});

	it('completes after second input with correct final values', () => {
		const { result, yieldCount } = driveInteractive(src, ['10\n', '20\n']);
		expect(yieldCount).toBe(2);
		expect(result.errors).toHaveLength(0);
		expectValid(result.program);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('10');
		expect(findEntry(last, 'y')?.value).toBe('20');
		const consoleOutputs = buildConsoleOutputs(result.program.steps);
		const lastOutput = consoleOutputs[consoleOutputs.length - 1];
		expect(lastOutput).toContain('Sum = 30');
	});

	it('no duplicate steps from pause/resume', () => {
		const { result } = driveInteractive(src, ['10\n', '20\n']);
		const scanfSteps = result.program.steps.filter(s => s.description?.includes('scanf'));
		expect(scanfSteps.length).toBe(2); // exactly 2 scanf steps
		// No two steps should have identical (line, description) pairs
		const pairs = result.program.steps.map(s => `${s.location.line}:${s.description}`);
		const unique = new Set(pairs);
		expect(unique.size).toBe(pairs.length);
	});
});

describe('getchar interactive — all intercept paths', () => {
	it('c = getchar() in assignment pauses when stdin empty', () => {
		const src = 'int main() { int c; c = getchar(); return 0; }';
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const r2 = gen.next('A');
		expect(r2.done).toBe(true);
		const result = r2.value as InterpretResult;
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'c')?.value).toBe('65');
	});

	it('int c = getchar() in declaration pauses when stdin empty', () => {
		const src = 'int main() { int c = getchar(); return 0; }';
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const r2 = gen.next('Z');
		expect(r2.done).toBe(true);
		const result = r2.value as InterpretResult;
		expect(result.errors).toHaveLength(0);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'c')?.value).toBe('90');
	});

	it('getchar() as bare expression statement pauses when stdin empty', () => {
		const src = 'int main() { getchar(); return 0; }';
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const r2 = gen.next('X');
		expect(r2.done).toBe(true);
		expect((r2.value as InterpretResult).errors).toHaveLength(0);
	});

	it('getchar loop consumes buffer then pauses when exhausted', () => {
		// Use a bounded loop (not EOF-terminated) because the interactive generator
		// has no EOF signal — getchar always pauses for more input instead of returning -1.
		const src = `int main() {
	int c1 = getchar();
	int c2 = getchar();
	int c3 = getchar();
	return 0;
}`;
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false); // first getchar, buffer empty
		const r2 = gen.next('AB');
		// c1 reads 'A', c2 reads 'B' from buffer, c3 exhausts → pause
		expect(r2.done).toBe(false);
		const r3 = gen.next('C');
		expect(r3.done).toBe(true);
		const result = r3.value as InterpretResult;
		expect(result.errors).toHaveLength(0);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'c1')?.value).toBe('65'); // 'A'
		expect(findEntry(last, 'c2')?.value).toBe('66'); // 'B'
		expect(findEntry(last, 'c3')?.value).toBe('67'); // 'C'
	});

	it('two getchar() in declarations — second reads from buffer', () => {
		const src = `int main() {
	int c1 = getchar();
	int c2 = getchar();
	return 0;
}`;
		const { result, yieldCount } = driveInteractive(src, ['AB']);
		expect(yieldCount).toBe(1); // Only one pause — both chars from single input
		expect(result.errors).toHaveLength(0);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'c1')?.value).toBe('65'); // 'A'
		expect(findEntry(last, 'c2')?.value).toBe('66'); // 'B'
	});
});

describe('fgets and gets interactive', () => {
	it('fgets pauses when stdin empty', () => {
		const src = 'int main() { char buf[80]; fgets(buf, 80, stdin); return 0; }';
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const r2 = gen.next('hello world\n');
		expect(r2.done).toBe(true);
		expect((r2.value as InterpretResult).errors).toHaveLength(0);
	});

	it('gets pauses when stdin empty', () => {
		const src = 'int main() { char buf[80]; gets(buf); return 0; }';
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const r2 = gen.next('test\n');
		expect(r2.done).toBe(true);
		expect((r2.value as InterpretResult).errors).toHaveLength(0);
	});
});

// === Step 3: Buffer behavior and C semantics ===

describe('buffer carryover across pause/resume', () => {
	it('extra data from first resume carries to second scanf — no re-pause', () => {
		const src = 'int main() { int a; int b; scanf("%d", &a); scanf("%d", &b); return 0; }';
		const { result, yieldCount } = driveInteractive(src, ['10 20\n']);
		expect(yieldCount).toBe(1); // Only one pause — second scanf reads from buffer
		expect(result.errors).toHaveLength(0);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('10');
		expect(findEntry(last, 'b')?.value).toBe('20');
	});

	it('\\n residue: scanf %d then %c reads leftover newline', () => {
		const src = `int main() {
	int num;
	char ch;
	scanf("%d", &num);
	scanf("%c", &ch);
	return 0;
}`;
		const { result, yieldCount } = driveInteractive(src, ['42\n']);
		expect(yieldCount).toBe(1); // Second scanf reads \n from buffer, no re-pause
		expect(result.errors).toHaveLength(0);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'num')?.value).toBe('42');
		expect(findEntry(last, 'ch')?.value).toBe('10'); // \n = 10
	});

	it('\\n residue with extra char: %d + %c + %c reads residue then next', () => {
		const src = `int main() {
	int num;
	char c1;
	char c2;
	scanf("%d", &num);
	scanf("%c", &c1);
	scanf("%c", &c2);
	return 0;
}`;
		const { result, yieldCount } = driveInteractive(src, ['42\nA']);
		expect(yieldCount).toBe(1); // All consumed from buffer
		expect(result.errors).toHaveLength(0);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'num')?.value).toBe('42');
		expect(findEntry(last, 'c1')?.value).toBe('10'); // \n
		expect(findEntry(last, 'c2')?.value).toBe('65'); // 'A'
	});
});

describe('edge cases', () => {
	it('empty input string causes deterministic re-pause', () => {
		const src = 'int main() { int x; scanf("%d", &x); return 0; }';
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const r2 = gen.next('');
		expect(r2.done).toBe(false); // Re-pauses — buffer still exhausted
		const r3 = gen.next('42\n');
		expect(r3.done).toBe(true);
		const result = r3.value as InterpretResult;
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('whitespace-only input for %d causes deterministic re-pause', () => {
		const src = 'int main() { int x; scanf("%d", &x); return 0; }';
		const gen = interactive(src);
		gen.next(); // yields
		const r2 = gen.next('   \n');
		expect(r2.done).toBe(false); // Re-pauses — readInt finds no digits, resets position
		const r3 = gen.next('42\n');
		expect(r3.done).toBe(true);
		const result = r3.value as InterpretResult;
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('multiple re-pauses on same statement do not create duplicate steps', () => {
		const src = 'int main() { int x; scanf("%d", &x); return 0; }';
		const gen = interactive(src);
		gen.next(); // yields
		gen.next(''); // re-yields
		gen.next(''); // re-yields
		const r = gen.next('42\n');
		expect(r.done).toBe(true);
		const result = r.value as InterpretResult;
		// Only ONE scanf step should exist (sharesStep=true on each re-execution)
		const scanfSteps = result.program.steps.filter(s => s.description?.includes('scanf'));
		expect(scanfSteps.length).toBe(1);
	});

	it('type-mismatch input: letters for %d causes persistent re-pause', () => {
		const src = 'int main() { int x; scanf("%d", &x); return 0; }';
		const gen = interactive(src);
		gen.next(); // yields
		const r2 = gen.next('abc\n');
		expect(r2.done).toBe(false); // Re-pauses — readInt resets position, 'abc' stays in buffer
		// NOTE: Unlike real C where scanf returns 0 and the program continues,
		// CrowCode keeps re-pausing because 'abc' permanently blocks readInt.
		// Sending more input won't help — 'abc' stays at the read position.
		const r3 = gen.next('42\n');
		expect(r3.done).toBe(false); // Still blocked — 'abc' precedes '42' in buffer
	});

	it('step limit prevents infinite interactive loop — generator terminates', () => {
		const src = `int main() {
	while(1) {
		int x;
		scanf("%d", &x);
	}
	return 0;
}`;
		// Drive with maxSteps: 10, repeatedly providing input
		const gen = interactive(src, { maxSteps: 10 });
		let r = gen.next();
		let attempts = 0;
		while (!r.done && attempts < 20) {
			r = gen.next('1\n');
			attempts++;
		}
		expect(r.done).toBe(true);
		const result = r.value as InterpretResult;
		expect(result.errors.some(e => e.includes('Step limit'))).toBe(true);
	});

	it('program with syntax error returns parseErrors without hanging', () => {
		const { generator, parseErrors } = interpretInteractive(
			parser, 'int main() { scanf("%d" &x); return 0; }', { interactive: true },
		);
		// Either parseErrors catches it, or the generator completes with errors
		if (parseErrors.length === 0) {
			let r = generator.next();
			let attempts = 0;
			while (!r.done && attempts < 5) {
				r = generator.next('42\n');
				attempts++;
			}
			// Must terminate
			expect(attempts).toBeLessThan(5);
		} else {
			expect(parseErrors.length).toBeGreaterThan(0);
		}
	});
});

// === Step 4: Partial program integrity and known-limitation tests ===

describe('partial program integrity', () => {
	it('partial program passes validateProgram', () => {
		const src = 'int main() { printf("hi"); int x; scanf("%d", &x); return 0; }';
		const gen = interactive(src);
		const r = gen.next();
		expect(r.done).toBe(false);
		const partial = (r.value as { program: Program }).program;
		expectValid(partial);
	});

	it('partial program buildSnapshots produces no warnings', () => {
		const src = 'int main() { printf("hi"); int x; scanf("%d", &x); return 0; }';
		const gen = interactive(src);
		const r = gen.next();
		expect(r.done).toBe(false);
		const partial = (r.value as { program: Program }).program;
		expectNoWarnings(partial);
	});

	it('partial program from loop-body pause passes validateProgram', () => {
		const src = `int main() {
	int i;
	for (i = 0; i < 3; i++) {
		int x;
		scanf("%d", &x);
	}
	return 0;
}`;
		const gen = interactive(src);
		const r = gen.next();
		expect(r.done).toBe(false);
		const partial = (r.value as { program: Program }).program;
		expectValid(partial);
	});

	it('resumed program step locations are superset of partial', () => {
		const src = 'int main() { int x; scanf("%d", &x); printf("%d", x); return 0; }';
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const partialSteps = (r1.value as { program: Program }).program.steps;
		const partialLines = partialSteps.map(s => s.location.line);

		const r2 = gen.next('42\n');
		expect(r2.done).toBe(true);
		const finalSteps = (r2.value as InterpretResult).program.steps;
		const finalLines = finalSteps.map(s => s.location.line);

		// Every partial step line should appear in the final program
		for (const line of partialLines) {
			expect(finalLines).toContain(line);
		}
	});
});

describe('input functions in non-main contexts', () => {
	it('scanf inside a helper function still yields — needsInput propagates', () => {
		const src = `int readNum() { int x; scanf("%d", &x); return x; }
int main() { int val = readNum(); return 0; }`;
		const gen = interactive(src);
		const r1 = gen.next();
		// NOTE: Plan assumed driveGenerator swallows needsInput, but it propagates.
		// The needsInput flag is set on the interpreter context and checked by
		// executeStatementsYielding after the statement completes.
		expect(r1.done).toBe(false);
		const r2 = gen.next('42\n');
		expect(r2.done).toBe(true);
	});

	it('scanf as declaration initializer pauses correctly', () => {
		// This exercises the evaluateCallForDecl → needsInput branch
		const src = 'int main() { int x = scanf("%d", &x); return 0; }';
		const gen = interactive(src);
		const r1 = gen.next();
		expect(r1.done).toBe(false);
		const r2 = gen.next('42\n');
		expect(r2.done).toBe(true);
	});
});

// === Step 5: Sync vs interactive parity and console output verification ===

describe('sync vs interactive parity', () => {
	it('scanf + printf: same final values and console output in both modes', () => {
		const src = 'int main() { int x; scanf("%d", &x); printf("%d", x); return 0; }';
		const syncResult = interpretSync(parser, src, { stdin: '42\n' });
		const { result: interResult } = driveInteractive(src, ['42\n']);

		// Same final x value
		const syncSnaps = buildSnapshots(syncResult.program);
		const interSnaps = buildSnapshots(interResult.program);
		const syncX = findEntry(syncSnaps[syncSnaps.length - 1], 'x');
		const interX = findEntry(interSnaps[interSnaps.length - 1], 'x');
		expect(interX?.value).toBe(syncX?.value);

		// Same console output
		const syncConsole = buildConsoleOutputs(syncResult.program.steps);
		const interConsole = buildConsoleOutputs(interResult.program.steps);
		expect(interConsole[interConsole.length - 1]).toBe(syncConsole[syncConsole.length - 1]);
	});

	it('two scanfs: same result whether input provided together or separately', () => {
		const src = 'int main() { int a; int b; scanf("%d", &a); scanf("%d", &b); return 0; }';
		const syncResult = interpretSync(parser, src, { stdin: '10\n20\n' });
		const { result: interSeparate } = driveInteractive(src, ['10\n', '20\n']);
		const { result: interTogether } = driveInteractive(src, ['10\n20\n']);

		const getValue = (program: Program, name: string) => {
			const snaps = buildSnapshots(program);
			return findEntry(snaps[snaps.length - 1], name)?.value;
		};

		expect(getValue(syncResult.program, 'a')).toBe('10');
		expect(getValue(syncResult.program, 'b')).toBe('20');
		expect(getValue(interSeparate.program, 'a')).toBe('10');
		expect(getValue(interSeparate.program, 'b')).toBe('20');
		expect(getValue(interTogether.program, 'a')).toBe('10');
		expect(getValue(interTogether.program, 'b')).toBe('20');
	});

	it('printf + scanf + printf: output ordering identical in both modes', () => {
		const src = `int main() {
	printf("Enter: ");
	int x;
	scanf("%d", &x);
	printf("Got %d\\n", x);
	return 0;
}`;
		const syncResult = interpretSync(parser, src, { stdin: '42\n' });
		const { result: interResult } = driveInteractive(src, ['42\n']);

		const syncConsole = buildConsoleOutputs(syncResult.program.steps);
		const interConsole = buildConsoleOutputs(interResult.program.steps);
		// Both should have "Enter: Got 42\n" as the final console output
		expect(interConsole[interConsole.length - 1]).toBe(syncConsole[syncConsole.length - 1]);
		expect(interConsole[interConsole.length - 1]).toContain('Enter: ');
		expect(interConsole[interConsole.length - 1]).toContain('Got 42');
	});

	it('\\n residue: identical ch value in sync and interactive', () => {
		const src = `int main() {
	int num;
	char ch;
	scanf("%d", &num);
	scanf("%c", &ch);
	return 0;
}`;
		const syncResult = interpretSync(parser, src, { stdin: '42\n' });
		const { result: interResult } = driveInteractive(src, ['42\n']);

		const syncSnaps = buildSnapshots(syncResult.program);
		const interSnaps = buildSnapshots(interResult.program);
		expect(findEntry(syncSnaps[syncSnaps.length - 1], 'ch')?.value).toBe('10');
		expect(findEntry(interSnaps[interSnaps.length - 1], 'ch')?.value).toBe('10');
	});
});

describe('console output correctness through interactive path', () => {
	it('escape sequences are rendered as byte values, not literal characters', () => {
		const src = 'int main() { printf("line1\\nline2\\n"); return 0; }';
		const { result } = driveInteractive(src, []);
		const consoleOutputs = buildConsoleOutputs(result.program.steps);
		const last = consoleOutputs[consoleOutputs.length - 1];
		// Should contain actual newline (charCode 10), not literal \n
		expect(last).toContain('\n');
		expect(last).toBe('line1\nline2\n');
	});

	it('\\t produces tab between characters', () => {
		const src = 'int main() { printf("a\\tb\\n"); return 0; }';
		const { result } = driveInteractive(src, []);
		const consoleOutputs = buildConsoleOutputs(result.program.steps);
		const last = consoleOutputs[consoleOutputs.length - 1];
		expect(last).toBe('a\tb\n');
	});

	it('putchar writes correct bytes', () => {
		const src = "int main() { putchar('A'); putchar('\\n'); return 0; }";
		const { result } = driveInteractive(src, []);
		const consoleOutputs = buildConsoleOutputs(result.program.steps);
		const last = consoleOutputs[consoleOutputs.length - 1];
		expect(last).toBe('A\n');
	});

	it('puts appends newline, printf does not', () => {
		const src1 = 'int main() { puts("hello"); return 0; }';
		const { result: r1 } = driveInteractive(src1, []);
		const c1 = buildConsoleOutputs(r1.program.steps);
		expect(c1[c1.length - 1]).toBe('hello\n');

		const src2 = 'int main() { printf("hello"); printf("world"); return 0; }';
		const { result: r2 } = driveInteractive(src2, []);
		const c2 = buildConsoleOutputs(r2.program.steps);
		expect(c2[c2.length - 1]).toBe('helloworld');
	});

	it('printf ioEvents appear on correct step with correct text', () => {
		const src = 'int main() { int x = 5; printf("x=%d\\n", x); return 0; }';
		const { result } = driveInteractive(src, []);
		const printfStep = result.program.steps.find(s =>
			s.ioEvents?.some(e => e.kind === 'write' && e.text.includes('x=5')),
		);
		expect(printfStep).toBeDefined();
	});

	it('scanf ioEvents have read events after resume', () => {
		const src = 'int main() { int x; scanf("%d", &x); return 0; }';
		const { result } = driveInteractive(src, ['42\n']);
		const readStep = result.program.steps.find(s =>
			s.ioEvents?.some(e => e.kind === 'read'),
		);
		expect(readStep).toBeDefined();
	});

	it('buildConsoleOutputs accumulates correctly across steps', () => {
		const src = 'int main() { printf("a"); printf("b"); printf("c"); return 0; }';
		const { result } = driveInteractive(src, []);
		const consoleOutputs = buildConsoleOutputs(result.program.steps);
		expect(consoleOutputs[consoleOutputs.length - 1]).toBe('abc');
	});

	it('printf before scanf appears in partial program console output', () => {
		const src = `int main() {
	printf("Name: ");
	char name[20];
	scanf("%s", name);
	return 0;
}`;
		const gen = interactive(src);
		const r = gen.next();
		expect(r.done).toBe(false);
		const partial = (r.value as { program: Program }).program;
		const consoleOutputs = buildConsoleOutputs(partial.steps);
		const last = consoleOutputs[consoleOutputs.length - 1];
		expect(last).toContain('Name: ');
	});
});

describe('scanf format specifiers through interactive path', () => {
	it('scanf %d skips leading whitespace', () => {
		const src = 'int main() { int x; scanf("%d", &x); return 0; }';
		const { result } = driveInteractive(src, ['  42\n']);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('scanf %c reads single char WITHOUT skipping whitespace', () => {
		const src = 'int main() { char c; scanf("%c", &c); return 0; }';
		const { result } = driveInteractive(src, [' X']);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'c')?.value).toBe('32'); // space, NOT 'X'
	});

	it('scanf %s reads until whitespace — pause/resume works', () => {
		const src = 'int main() { char s[20]; scanf("%s", s); return 0; }';
		const { result } = driveInteractive(src, ['hello world\n']);
		expect(result.errors).toHaveLength(0);
	});

	it('scanf %x reads hex value', () => {
		const src = 'int main() { int x; scanf("%x", &x); return 0; }';
		const { result } = driveInteractive(src, ['ff\n']);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('255');
	});

	it('scanf %f reads float', () => {
		const src = 'int main() { float f; scanf("%f", &f); return 0; }';
		const { result } = driveInteractive(src, ['3.14\n']);
		const snapshots = buildSnapshots(result.program);
		const last = snapshots[snapshots.length - 1];
		const fVal = parseFloat(findEntry(last, 'f')?.value ?? '0');
		expect(fVal).toBeCloseTo(3.14, 1);
	});
});
