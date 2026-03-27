import { describe, it, expect } from 'vitest';
import { IoState } from './io-state';

describe('IoState', () => {
	describe('stdout', () => {
		it('accumulates written text', () => {
			const io = new IoState();
			io.writeStdout('hello ');
			io.writeStdout('world');
			expect(io.getStdout()).toBe('hello world');
		});

		it('records write events', () => {
			const io = new IoState();
			io.writeStdout('hello');
			const events = io.flushEvents();
			expect(events).toHaveLength(1);
			expect(events![0]).toEqual({ kind: 'write', target: 'stdout', text: 'hello' });
		});
	});

	describe('stderr', () => {
		it('accumulates separately from stdout', () => {
			const io = new IoState();
			io.writeStdout('out');
			io.writeStderr('err');
			expect(io.getStdout()).toBe('out');
			expect(io.getStderr()).toBe('err');
		});

		it('records stderr events', () => {
			const io = new IoState();
			io.writeStderr('error');
			const events = io.flushEvents();
			expect(events![0]).toEqual({ kind: 'write', target: 'stderr', text: 'error' });
		});
	});

	describe('readChar', () => {
		it('reads next byte without skipping whitespace', () => {
			const io = new IoState('A');
			const result = io.readChar();
			expect(result!.value).toBe(65);
			expect(result!.consumed).toBe('A');
		});

		it('reads newline without skipping it', () => {
			const io = new IoState('\nA');
			const result = io.readChar();
			expect(result!.value).toBe(10); // '\n'
			expect(io.getStdinRemaining()).toBe('A');
		});

		it('returns null on EOF', () => {
			const io = new IoState('');
			expect(io.readChar()).toBeNull();
		});

		it('returns null on exhausted buffer', () => {
			const io = new IoState('A');
			io.readChar();
			expect(io.readChar()).toBeNull();
		});
	});

	describe('readInt', () => {
		it('reads positive integer', () => {
			const io = new IoState('42\n');
			const result = io.readInt();
			expect(result!.value).toBe(42);
		});

		it('skips leading whitespace', () => {
			const io = new IoState('  42  ');
			const result = io.readInt();
			expect(result!.value).toBe(42);
		});

		it('reads negative integer', () => {
			const io = new IoState('-7');
			const result = io.readInt();
			expect(result!.value).toBe(-7);
		});

		it('returns null on empty input', () => {
			const io = new IoState('');
			expect(io.readInt()).toBeNull();
		});

		it('returns null on non-numeric input (match failure)', () => {
			const io = new IoState('abc');
			expect(io.readInt()).toBeNull();
			// Cursor should not advance past non-matching input
			expect(io.getStdinPos()).toBe(0);
		});

		it('stops at non-digit character', () => {
			const io = new IoState('42abc');
			const result = io.readInt();
			expect(result!.value).toBe(42);
			expect(io.getStdinRemaining()).toBe('abc');
		});

		it('returns null on whitespace-only input', () => {
			const io = new IoState('   ');
			expect(io.readInt()).toBeNull();
		});
	});

	describe('readFloat', () => {
		it('reads float with decimal point', () => {
			const io = new IoState('3.14\n');
			const result = io.readFloat();
			expect(result!.value).toBeCloseTo(3.14);
		});

		it('reads integer as float', () => {
			const io = new IoState('42');
			const result = io.readFloat();
			expect(result!.value).toBe(42);
		});

		it('skips leading whitespace', () => {
			const io = new IoState('  3.14');
			const result = io.readFloat();
			expect(result!.value).toBeCloseTo(3.14);
		});

		it('returns null on non-numeric input', () => {
			const io = new IoState('abc');
			expect(io.readFloat()).toBeNull();
		});
	});

	describe('readString', () => {
		it('reads until whitespace', () => {
			const io = new IoState('hello world');
			const result = io.readString();
			expect(result!.value).toBe('hello');
			expect(io.getStdinRemaining()).toBe(' world');
		});

		it('skips leading whitespace', () => {
			const io = new IoState('  hello');
			const result = io.readString();
			expect(result!.value).toBe('hello');
		});

		it('returns null on empty input', () => {
			const io = new IoState('');
			expect(io.readString()).toBeNull();
		});

		it('returns null on whitespace-only input', () => {
			const io = new IoState('   ');
			expect(io.readString()).toBeNull();
		});
	});

	describe('\\n residue (the core educational scenario)', () => {
		it('readInt then readChar reads the leftover newline', () => {
			const io = new IoState('42\nA');
			const r1 = io.readInt();
			const r2 = io.readChar();
			expect(r1!.value).toBe(42);
			expect(r2!.value).toBe(10); // '\n', NOT 65 ('A')
			expect(io.getStdinRemaining()).toBe('A');
		});

		it('readInt then readInt skips the newline', () => {
			const io = new IoState('42\n7');
			const r1 = io.readInt();
			const r2 = io.readInt();
			expect(r1!.value).toBe(42);
			expect(r2!.value).toBe(7); // %d skips whitespace
		});
	});

	describe('readLine (fgets semantics)', () => {
		it('reads up to maxLen-1 chars including newline', () => {
			const io = new IoState('hello\nworld');
			const result = io.readLine(10);
			expect(result!.value).toBe('hello\n');
			expect(io.getStdinRemaining()).toBe('world');
		});

		it('truncates at maxLen-1 if no newline', () => {
			const io = new IoState('hello\nworld');
			const result = io.readLine(4);
			expect(result!.value).toBe('hel');
		});

		it('reads partial line at EOF without newline', () => {
			const io = new IoState('hello');
			const result = io.readLine(10);
			expect(result!.value).toBe('hello');
		});

		it('returns null on EOF', () => {
			const io = new IoState('');
			expect(io.readLine(10)).toBeNull();
		});

		it('maxLen=1 returns empty string (only null terminator)', () => {
			const io = new IoState('hello');
			const result = io.readLine(1);
			expect(result!.value).toBe('');
		});

		it('maxLen<=0 returns null', () => {
			const io = new IoState('hello');
			expect(io.readLine(0)).toBeNull();
			expect(io.readLine(-1)).toBeNull();
		});
	});

	describe('readUntilNewline (gets semantics)', () => {
		it('reads until newline without including it', () => {
			const io = new IoState('hello\nworld');
			const result = io.readUntilNewline();
			expect(result!.value).toBe('hello');
			expect(io.getStdinRemaining()).toBe('world');
		});

		it('reads until EOF if no newline', () => {
			const io = new IoState('hello');
			const result = io.readUntilNewline();
			expect(result!.value).toBe('hello');
		});

		it('returns more chars than any buffer size (unbounded)', () => {
			const io = new IoState('AAAAAAAAAA\n');
			const result = io.readUntilNewline();
			expect(result!.value).toBe('AAAAAAAAAA');
			expect(result!.value.length).toBe(10);
		});

		it('returns null on EOF', () => {
			const io = new IoState('');
			expect(io.readUntilNewline()).toBeNull();
		});
	});

	describe('readHexInt', () => {
		it('reads hex number', () => {
			const io = new IoState('ff');
			const result = io.readHexInt();
			expect(result!.value).toBe(255);
		});

		it('reads hex with 0x prefix', () => {
			const io = new IoState('0xff');
			const result = io.readHexInt();
			expect(result!.value).toBe(255);
		});

		it('skips leading whitespace', () => {
			const io = new IoState('  ff');
			const result = io.readHexInt();
			expect(result!.value).toBe(255);
		});
	});

	describe('flushEvents', () => {
		it('returns undefined when no events', () => {
			const io = new IoState();
			expect(io.flushEvents()).toBeUndefined();
		});

		it('returns events and clears buffer', () => {
			const io = new IoState();
			io.writeStdout('hello');
			const events1 = io.flushEvents();
			expect(events1).toHaveLength(1);

			const events2 = io.flushEvents();
			expect(events2).toBeUndefined();
		});

		it('step boundary: only returns current step events', () => {
			const io = new IoState();
			io.writeStdout('hello ');
			io.flushEvents(); // step 1 events flushed

			io.writeStdout('world');
			const events = io.flushEvents(); // step 2 events
			expect(events).toHaveLength(1);
			expect(events![0]).toEqual({ kind: 'write', target: 'stdout', text: 'world' });
		});
	});

	describe('exhaustion', () => {
		it('isExhausted returns true on empty buffer', () => {
			const io = new IoState('');
			expect(io.isExhausted()).toBe(true);
		});

		it('isExhausted returns true after full consumption', () => {
			const io = new IoState('A');
			io.readChar();
			expect(io.isExhausted()).toBe(true);
		});

		it('getStdinRemaining returns empty string when exhausted', () => {
			const io = new IoState('A');
			io.readChar();
			expect(io.getStdinRemaining()).toBe('');
		});

		it('getStdinPos tracks cursor correctly', () => {
			const io = new IoState('42\nA');
			expect(io.getStdinPos()).toBe(0);
			io.readInt(); // consumes "42"
			expect(io.getStdinPos()).toBe(2);
			io.readChar(); // consumes "\n"
			expect(io.getStdinPos()).toBe(3);
		});
	});
});
