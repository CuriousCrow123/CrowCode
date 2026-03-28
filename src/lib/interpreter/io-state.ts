import type { IoEvent } from '$lib/types';

// === IoState: Manages stdin/stdout/stderr buffers and IoEvent recording ===

export class IoState {
	private stdinBuffer: string;
	private stdinPos = 0;
	private stdoutBuffer = '';
	private stderrBuffer = '';
	private stepEvents: IoEvent[] = [];
	private eofSignaled = false;

	constructor(stdin: string = '') {
		this.stdinBuffer = stdin;
	}

	/** Append new input to the stdin buffer. Used during interactive mode. */
	appendStdin(text: string): void {
		this.stdinBuffer += text;
	}

	/** Signal that no more input will be provided (Ctrl+D / EOF). */
	signalEof(): void {
		this.eofSignaled = true;
	}

	/** Whether EOF has been explicitly signaled by the user. */
	isEofSignaled(): boolean {
		return this.eofSignaled;
	}

	// === Stdout ===

	writeStdout(text: string): void {
		this.stdoutBuffer += text;
		this.stepEvents.push({ kind: 'write', target: 'stdout', text });
	}

	writeStderr(text: string): void {
		this.stderrBuffer += text;
		this.stepEvents.push({ kind: 'write', target: 'stderr', text });
	}

	getStdout(): string {
		return this.stdoutBuffer;
	}

	getStderr(): string {
		return this.stderrBuffer;
	}

	// === Stdin ===

	isExhausted(): boolean {
		return this.eofSignaled || this.stdinPos >= this.stdinBuffer.length;
	}

	getStdinPos(): number {
		return this.stdinPos;
	}

	getStdinRemaining(): string {
		return this.stdinBuffer.slice(this.stdinPos);
	}

	getStdinFull(): string {
		return this.stdinBuffer;
	}

	/** Read a single character from stdin. Returns null on EOF. */
	readChar(): { value: number; consumed: string } | null {
		if (this.isExhausted()) return null;

		const ch = this.stdinBuffer[this.stdinPos];
		this.stdinPos++;
		const consumed = ch;

		this.stepEvents.push({
			kind: 'read',
			source: 'stdin',
			consumed,
			cursorPos: this.stdinPos,
		});

		return { value: ch.charCodeAt(0), consumed };
	}

	/** Skip whitespace characters in the stdin buffer. Returns the skipped text. */
	private skipWhitespace(): string {
		let skipped = '';
		while (this.stdinPos < this.stdinBuffer.length) {
			const ch = this.stdinBuffer[this.stdinPos];
			if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
				skipped += ch;
				this.stdinPos++;
			} else {
				break;
			}
		}
		return skipped;
	}

	/** Read an integer from stdin. Skips leading whitespace. Returns null on EOF or match failure. */
	readInt(): { value: number; consumed: string } | null {
		const startPos = this.stdinPos;
		this.skipWhitespace();

		if (this.isExhausted()) {
			this.stdinPos = startPos;
			return null;
		}

		let numStr = '';
		const firstChar = this.stdinBuffer[this.stdinPos];
		if (firstChar === '-' || firstChar === '+') {
			numStr += firstChar;
			this.stdinPos++;
		}

		let hasDigits = false;
		while (this.stdinPos < this.stdinBuffer.length) {
			const ch = this.stdinBuffer[this.stdinPos];
			if (ch >= '0' && ch <= '9') {
				numStr += ch;
				this.stdinPos++;
				hasDigits = true;
			} else {
				break;
			}
		}

		if (!hasDigits) {
			// Match failure — reset to before whitespace skip
			this.stdinPos = startPos;
			return null;
		}

		const consumed = this.stdinBuffer.slice(startPos, this.stdinPos);
		const value = parseInt(numStr, 10);

		this.stepEvents.push({
			kind: 'read',
			source: 'stdin',
			consumed,
			cursorPos: this.stdinPos,
		});

		return { value, consumed };
	}

	/** Read a float from stdin. Skips leading whitespace. Returns null on EOF or match failure. */
	readFloat(): { value: number; consumed: string } | null {
		const startPos = this.stdinPos;
		this.skipWhitespace();

		if (this.isExhausted()) {
			this.stdinPos = startPos;
			return null;
		}

		let numStr = '';
		const firstChar = this.stdinBuffer[this.stdinPos];
		if (firstChar === '-' || firstChar === '+') {
			numStr += firstChar;
			this.stdinPos++;
		}

		let hasDigits = false;
		let hasDot = false;
		while (this.stdinPos < this.stdinBuffer.length) {
			const ch = this.stdinBuffer[this.stdinPos];
			if (ch >= '0' && ch <= '9') {
				numStr += ch;
				this.stdinPos++;
				hasDigits = true;
			} else if (ch === '.' && !hasDot) {
				numStr += ch;
				this.stdinPos++;
				hasDot = true;
			} else {
				break;
			}
		}

		if (!hasDigits) {
			this.stdinPos = startPos;
			return null;
		}

		const consumed = this.stdinBuffer.slice(startPos, this.stdinPos);
		const value = parseFloat(numStr);

		this.stepEvents.push({
			kind: 'read',
			source: 'stdin',
			consumed,
			cursorPos: this.stdinPos,
		});

		return { value, consumed };
	}

	/** Read a string from stdin. Skips leading whitespace, reads until next whitespace. Returns null on EOF. */
	readString(): { value: string; consumed: string } | null {
		const startPos = this.stdinPos;
		this.skipWhitespace();

		if (this.isExhausted()) {
			this.stdinPos = startPos;
			return null;
		}

		let str = '';
		while (this.stdinPos < this.stdinBuffer.length) {
			const ch = this.stdinBuffer[this.stdinPos];
			if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') break;
			str += ch;
			this.stdinPos++;
		}

		if (str.length === 0) {
			this.stdinPos = startPos;
			return null;
		}

		const consumed = this.stdinBuffer.slice(startPos, this.stdinPos);

		this.stepEvents.push({
			kind: 'read',
			source: 'stdin',
			consumed,
			cursorPos: this.stdinPos,
		});

		return { value: str, consumed };
	}

	/** Read a line from stdin (fgets semantics). Reads up to maxLen-1 chars or until \n (inclusive). Returns null on EOF. */
	readLine(maxLen: number): { value: string; consumed: string } | null {
		if (this.isExhausted()) return null;
		if (maxLen <= 0) return null;

		const startPos = this.stdinPos;
		let str = '';
		const limit = maxLen - 1; // leave room for null terminator

		if (limit <= 0) {
			// fgets(buf, 1, stdin) writes only \0, returns buf
			return { value: '', consumed: '' };
		}

		while (str.length < limit && this.stdinPos < this.stdinBuffer.length) {
			const ch = this.stdinBuffer[this.stdinPos];
			str += ch;
			this.stdinPos++;
			if (ch === '\n') break;
		}

		if (str.length === 0) return null;

		const consumed = this.stdinBuffer.slice(startPos, this.stdinPos);

		this.stepEvents.push({
			kind: 'read',
			source: 'stdin',
			consumed,
			cursorPos: this.stdinPos,
		});

		return { value: str, consumed };
	}

	/** Read until newline (gets semantics). No bounds checking. Returns null on EOF. */
	readUntilNewline(): { value: string; consumed: string } | null {
		if (this.isExhausted()) return null;

		const startPos = this.stdinPos;
		let str = '';

		while (this.stdinPos < this.stdinBuffer.length) {
			const ch = this.stdinBuffer[this.stdinPos];
			this.stdinPos++;
			if (ch === '\n') break;
			str += ch;
		}

		const consumed = this.stdinBuffer.slice(startPos, this.stdinPos);

		this.stepEvents.push({
			kind: 'read',
			source: 'stdin',
			consumed,
			cursorPos: this.stdinPos,
		});

		return { value: str, consumed };
	}

	/** Read a hex integer from stdin. Skips leading whitespace. Handles optional 0x prefix. */
	readHexInt(): { value: number; consumed: string } | null {
		const startPos = this.stdinPos;
		this.skipWhitespace();

		if (this.isExhausted()) {
			this.stdinPos = startPos;
			return null;
		}

		// Optional 0x prefix
		if (
			this.stdinPos + 1 < this.stdinBuffer.length &&
			this.stdinBuffer[this.stdinPos] === '0' &&
			(this.stdinBuffer[this.stdinPos + 1] === 'x' || this.stdinBuffer[this.stdinPos + 1] === 'X')
		) {
			this.stdinPos += 2;
		}

		let numStr = '';
		let hasDigits = false;
		while (this.stdinPos < this.stdinBuffer.length) {
			const ch = this.stdinBuffer[this.stdinPos].toLowerCase();
			if ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
				numStr += ch;
				this.stdinPos++;
				hasDigits = true;
			} else {
				break;
			}
		}

		if (!hasDigits) {
			this.stdinPos = startPos;
			return null;
		}

		const consumed = this.stdinBuffer.slice(startPos, this.stdinPos);
		const value = parseInt(numStr, 16);

		this.stepEvents.push({
			kind: 'read',
			source: 'stdin',
			consumed,
			cursorPos: this.stdinPos,
		});

		return { value, consumed };
	}

	// === Step Lifecycle ===

	/** Flush and return all IoEvents recorded since the last flush. Returns undefined if no events. */
	flushEvents(): IoEvent[] | undefined {
		if (this.stepEvents.length === 0) return undefined;
		const events = this.stepEvents;
		this.stepEvents = [];
		return events;
	}

	/** Non-destructive peek at pending IoEvents (for partial snapshots). */
	peekEvents(): IoEvent[] | undefined {
		if (this.stepEvents.length === 0) return undefined;
		return [...this.stepEvents];
	}
}
