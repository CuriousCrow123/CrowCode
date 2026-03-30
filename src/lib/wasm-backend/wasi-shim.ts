/**
 * Minimal WASI shim for running xcc compiler (cc.wasm) and user programs in the browser.
 *
 * Two usage contexts:
 * 1. Compiler WASI — full virtual FS with headers/libs, args, stdout/stderr capture
 * 2. User Program WASI — minimal, I/O only (most functions handled via __crow_* imports)
 */

import { StdinExhausted } from './op-collector';

// WASI error codes
const WASI_ERRNO_SUCCESS = 0;
const WASI_ERRNO_BADF = 8;
const WASI_ERRNO_NOSYS = 52;
const WASI_ERRNO_NOENT = 44;
const WASI_ERRNO_INVAL = 28;

// WASI file types
const WASI_FILETYPE_REGULAR_FILE = 4;
const WASI_FILETYPE_DIRECTORY = 3;

// WASI rights (we grant all)
const WASI_RIGHTS_ALL = BigInt('0x1FFFFFFF');

export class CompilationComplete {
	constructor(public code: number) {}
}

export class ProgramExit {
	constructor(public code: number) {}
}

type VirtualFile = {
	content: Uint8Array;
	readonly: boolean;
};

export class VirtualFS {
	private files = new Map<string, VirtualFile>();
	private directories = new Set<string>();

	constructor() {
		this.directories.add('/');
	}

	addFile(path: string, content: Uint8Array | string, readonly = true): void {
		const normalized = this.normalize(path);
		this.files.set(normalized, {
			content: typeof content === 'string' ? new TextEncoder().encode(content) : content,
			readonly,
		});
		// Ensure parent directories exist
		const parts = normalized.split('/');
		for (let i = 1; i < parts.length; i++) {
			this.directories.add(parts.slice(0, i).join('/') || '/');
		}
	}

	getFile(path: string): VirtualFile | undefined {
		return this.files.get(this.normalize(path));
	}

	writeFile(path: string, content: Uint8Array): void {
		const normalized = this.normalize(path);
		const existing = this.files.get(normalized);
		if (existing && existing.readonly) {
			throw new Error(`Cannot write to readonly file: ${path}`);
		}
		this.files.set(normalized, { content, readonly: false });
	}

	isDirectory(path: string): boolean {
		return this.directories.has(this.normalize(path));
	}

	exists(path: string): boolean {
		const normalized = this.normalize(path);
		return this.files.has(normalized) || this.directories.has(normalized);
	}

	private normalize(path: string): string {
		// Remove trailing slashes, collapse double slashes
		return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
	}
}

type FdEntry = {
	path: string;
	offset: number;
	isDir: boolean;
};

export type WasiOptions = {
	args?: string[];
	fs: VirtualFS;
	stdout?: (text: string) => void;
	stderr?: (text: string) => void;
	onExit?: (code: number) => void;
	onStdinRead?: (consumed: string, cursorPos: number) => void;
};

export class WasiShim {
	private memory!: WebAssembly.Memory;
	private fds = new Map<number, FdEntry>();
	private nextFd = 3;
	private args: string[];
	private fs: VirtualFS;
	private stdout: (text: string) => void;
	private stderr: (text: string) => void;
	private onExit: (code: number) => void;
	private onStdinRead: ((consumed: string, cursorPos: number) => void) | null;
	private preopenDirs = ['/'];
	private decoder = new TextDecoder();
	private stdinEof = false;

	constructor(options: WasiOptions) {
		this.args = options.args ?? [];
		this.fs = options.fs;
		this.stdout = options.stdout ?? (() => {});
		this.stderr = options.stderr ?? (() => {});
		this.onExit = options.onExit ?? ((code) => { throw new CompilationComplete(code); });
		this.onStdinRead = options.onStdinRead ?? null;

		// Pre-open fd 0 (stdin), 1 (stdout), 2 (stderr)
		this.fds.set(0, { path: '<stdin>', offset: 0, isDir: false });
		this.fds.set(1, { path: '<stdout>', offset: 0, isDir: false });
		this.fds.set(2, { path: '<stderr>', offset: 0, isDir: false });

		// Pre-open root directory as fd 3
		this.fds.set(3, { path: '/', offset: 0, isDir: true });
		this.nextFd = 4;
	}

	signalStdinEof(): void {
		this.stdinEof = true;
	}

	setMemory(memory: WebAssembly.Memory): void {
		this.memory = memory;
	}

	private view(): DataView {
		return new DataView(this.memory.buffer);
	}

	private bytes(): Uint8Array {
		return new Uint8Array(this.memory.buffer);
	}

	private readString(ptr: number, len: number): string {
		return this.decoder.decode(this.bytes().subarray(ptr, ptr + len));
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getImports(): Record<string, (...args: any[]) => number | void> {
		return {
			fd_write: (fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) =>
				this.fd_write(fd, iovsPtr, iovsLen, nwrittenPtr),
			fd_read: (fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) =>
				this.fd_read(fd, iovsPtr, iovsLen, nreadPtr),
			fd_close: (fd: number) => this.fd_close(fd),
			// fd_seek: (fd, offset: i64, whence, newOffsetPtr)
			fd_seek: (fd: number, offset: bigint, whence: number, newOffsetPtr: number) =>
				this.fd_seek(fd, Number(offset), whence, newOffsetPtr),
			fd_prestat_get: (fd: number, bufPtr: number) => this.fd_prestat_get(fd, bufPtr),
			fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number) =>
				this.fd_prestat_dir_name(fd, pathPtr, pathLen),
			fd_filestat_get: (fd: number, bufPtr: number) => this.fd_filestat_get(fd, bufPtr),
			fd_fdstat_get: (fd: number, bufPtr: number) => this.fd_fdstat_get(fd, bufPtr),
			// path_open: (fd, dirflags, path, path_len, oflags, rights_base: i64, rights_inheriting: i64, fdflags, opened_fd)
			path_open: (dirFd: number, _dirflags: number, pathPtr: number, pathLen: number,
				_oflags: number, _rightsBase: bigint, _rightsInheriting: bigint,
				_fdflags: number, fdPtr: number) =>
				this.path_open(dirFd, pathPtr, pathLen, fdPtr),
			path_filestat_get: (fd: number, _flags: number, pathPtr: number, pathLen: number, bufPtr: number) =>
				this.path_filestat_get(fd, pathPtr, pathLen, bufPtr),
			proc_exit: (code: number) => this.proc_exit(code),
			args_sizes_get: (argcPtr: number, argvBufSizePtr: number) =>
				this.args_sizes_get(argcPtr, argvBufSizePtr),
			args_get: (argvPtr: number, argvBufPtr: number) =>
				this.args_get(argvPtr, argvBufPtr),
			environ_sizes_get: (countPtr: number, sizePtr: number) => {
				this.view().setUint32(countPtr, 0, true);
				this.view().setUint32(sizePtr, 0, true);
				return WASI_ERRNO_SUCCESS;
			},
			environ_get: () => WASI_ERRNO_SUCCESS,
			clock_time_get: (_clockId: number, _precision: bigint, timePtr: number) => {
				const now = BigInt(Date.now()) * BigInt(1_000_000);
				this.view().setBigUint64(timePtr, now, true);
				return WASI_ERRNO_SUCCESS;
			},
			random_get: (bufPtr: number, bufLen: number) => {
				const buf = this.bytes().subarray(bufPtr, bufPtr + bufLen);
				crypto.getRandomValues(buf);
				return WASI_ERRNO_SUCCESS;
			},
			poll_oneoff: () => WASI_ERRNO_NOSYS,
			sched_yield: () => WASI_ERRNO_SUCCESS,
			// Filesystem stubs (not needed but xcc imports them)
			path_unlink_file: () => WASI_ERRNO_NOSYS,
			path_rename: () => WASI_ERRNO_NOSYS,
			path_create_directory: () => WASI_ERRNO_NOSYS,
			path_remove_directory: () => WASI_ERRNO_NOSYS,
			path_symlink: () => WASI_ERRNO_NOSYS,
			path_readlink: () => WASI_ERRNO_NOSYS,
			fd_readdir: () => WASI_ERRNO_NOSYS,
			fd_allocate: () => WASI_ERRNO_NOSYS,
			fd_sync: () => WASI_ERRNO_SUCCESS,
			fd_datasync: () => WASI_ERRNO_SUCCESS,
			fd_fdstat_set_flags: () => WASI_ERRNO_SUCCESS,
			fd_filestat_set_size: () => WASI_ERRNO_NOSYS,
			fd_filestat_set_times: () => WASI_ERRNO_NOSYS,
			fd_pread: () => WASI_ERRNO_NOSYS,
			fd_pwrite: () => WASI_ERRNO_NOSYS,
			fd_renumber: () => WASI_ERRNO_NOSYS,
			fd_advise: () => WASI_ERRNO_SUCCESS,
			sock_recv: () => WASI_ERRNO_NOSYS,
			sock_send: () => WASI_ERRNO_NOSYS,
			sock_shutdown: () => WASI_ERRNO_NOSYS,
			sock_accept: () => WASI_ERRNO_NOSYS,
		};
	}

	private fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
		const view = this.view();
		let written = 0;

		for (let i = 0; i < iovsLen; i++) {
			const ptr = view.getUint32(iovsPtr + i * 8, true);
			const len = view.getUint32(iovsPtr + i * 8 + 4, true);
			const text = this.readString(ptr, len);

			if (fd === 1) {
				this.stdout(text);
			} else if (fd === 2) {
				this.stderr(text);
			} else {
				// Writing to a file fd
				const entry = this.fds.get(fd);
				if (!entry) return WASI_ERRNO_BADF;
				const data = this.bytes().slice(ptr, ptr + len);
				const file = this.fs.getFile(entry.path);
				if (file) {
					// Append to existing content
					const newContent = new Uint8Array(file.content.length + data.length);
					newContent.set(file.content);
					newContent.set(data, file.content.length);
					this.fs.writeFile(entry.path, newContent);
				} else {
					this.fs.writeFile(entry.path, data);
				}
			}
			written += len;
		}

		view.setUint32(nwrittenPtr, written, true);
		return WASI_ERRNO_SUCCESS;
	}

	private fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number): number {
		const view = this.view();
		const entry = this.fds.get(fd);
		if (!entry) return WASI_ERRNO_BADF;

		const file = this.fs.getFile(entry.path);
		if (!file) {
			// stdin (fd 0) with no data — pause for interactive input or return EOF
			if (fd === 0 && !this.stdinEof) {
				throw new StdinExhausted();
			}
			view.setUint32(nreadPtr, 0, true);
			return WASI_ERRNO_SUCCESS;
		}

		let totalRead = 0;
		for (let i = 0; i < iovsLen; i++) {
			const bufPtr = view.getUint32(iovsPtr + i * 8, true);
			const bufLen = view.getUint32(iovsPtr + i * 8 + 4, true);
			const available = file.content.length - entry.offset;
			const toRead = Math.min(bufLen, available);
			if (toRead > 0) {
				this.bytes().set(file.content.subarray(entry.offset, entry.offset + toRead), bufPtr);
				entry.offset += toRead;
				totalRead += toRead;
			}
			if (toRead < bufLen) break;
		}

		// Emit stdin read event for buffer visualization
		if (fd === 0 && totalRead > 0 && this.onStdinRead) {
			const consumed = this.decoder.decode(file.content.subarray(entry.offset - totalRead, entry.offset));
			this.onStdinRead(consumed, entry.offset);
		}

		// stdin exhausted — pause for interactive input or return EOF
		if (fd === 0 && totalRead === 0 && !this.stdinEof) {
			throw new StdinExhausted();
		}

		view.setUint32(nreadPtr, totalRead, true);
		return WASI_ERRNO_SUCCESS;
	}

	private fd_close(fd: number): number {
		if (fd < 3) return WASI_ERRNO_SUCCESS;
		this.fds.delete(fd);
		return WASI_ERRNO_SUCCESS;
	}

	private fd_seek(fd: number, offset: number, whence: number, newOffsetPtr: number): number {
		const entry = this.fds.get(fd);
		if (!entry) return WASI_ERRNO_BADF;

		const file = this.fs.getFile(entry.path);
		const size = file ? file.content.length : 0;

		switch (whence) {
			case 0: entry.offset = offset; break; // SEEK_SET
			case 1: entry.offset += offset; break; // SEEK_CUR
			case 2: entry.offset = size + offset; break; // SEEK_END
			default: return WASI_ERRNO_INVAL;
		}

		const view = this.view();
		view.setBigUint64(newOffsetPtr, BigInt(entry.offset), true);
		return WASI_ERRNO_SUCCESS;
	}

	private fd_prestat_get(fd: number, bufPtr: number): number {
		// fd 3 is the preopened root directory
		const preopenIdx = fd - 3;
		if (preopenIdx < 0 || preopenIdx >= this.preopenDirs.length) {
			return WASI_ERRNO_BADF;
		}

		const view = this.view();
		const dirPath = this.preopenDirs[preopenIdx];
		view.setUint32(bufPtr, 0, true); // preopen type = directory
		view.setUint32(bufPtr + 4, new TextEncoder().encode(dirPath).length, true);
		return WASI_ERRNO_SUCCESS;
	}

	private fd_prestat_dir_name(fd: number, pathPtr: number, pathLen: number): number {
		const preopenIdx = fd - 3;
		if (preopenIdx < 0 || preopenIdx >= this.preopenDirs.length) {
			return WASI_ERRNO_BADF;
		}

		const encoded = new TextEncoder().encode(this.preopenDirs[preopenIdx]);
		this.bytes().set(encoded.subarray(0, pathLen), pathPtr);
		return WASI_ERRNO_SUCCESS;
	}

	private fd_filestat_get(fd: number, bufPtr: number): number {
		const entry = this.fds.get(fd);
		if (!entry) return WASI_ERRNO_BADF;

		const view = this.view();
		// filestat is 64 bytes
		for (let i = 0; i < 64; i++) view.setUint8(bufPtr + i, 0);

		if (entry.isDir) {
			view.setUint8(bufPtr + 16, WASI_FILETYPE_DIRECTORY);
		} else {
			const file = this.fs.getFile(entry.path);
			view.setUint8(bufPtr + 16, WASI_FILETYPE_REGULAR_FILE);
			if (file) {
				view.setBigUint64(bufPtr + 32, BigInt(file.content.length), true);
			}
		}
		return WASI_ERRNO_SUCCESS;
	}

	private fd_fdstat_get(fd: number, bufPtr: number): number {
		const entry = this.fds.get(fd);
		if (!entry) return WASI_ERRNO_BADF;

		const view = this.view();
		// fdstat is 24 bytes
		for (let i = 0; i < 24; i++) view.setUint8(bufPtr + i, 0);
		view.setUint8(bufPtr, entry.isDir ? WASI_FILETYPE_DIRECTORY : WASI_FILETYPE_REGULAR_FILE);
		// rights base and inheriting (8 bytes each)
		view.setBigUint64(bufPtr + 8, WASI_RIGHTS_ALL, true);
		view.setBigUint64(bufPtr + 16, WASI_RIGHTS_ALL, true);
		return WASI_ERRNO_SUCCESS;
	}

	private path_open(dirFd: number, pathPtr: number, pathLen: number, fdPtr: number): number {
		const entry = this.fds.get(dirFd);
		if (!entry) return WASI_ERRNO_BADF;

		const relPath = this.readString(pathPtr, pathLen);
		const fullPath = entry.path === '/' ? `/${relPath}` : `${entry.path}/${relPath}`;
		const normalized = fullPath.replace(/\/+/g, '/');

		const isDir = this.fs.isDirectory(normalized);
		const file = this.fs.getFile(normalized);

		if (!file && !isDir) {
			// Create the file (for compiler output)
			this.fs.addFile(normalized, new Uint8Array(0), false);
		}

		const fd = this.nextFd++;
		this.fds.set(fd, { path: normalized, offset: 0, isDir });
		this.view().setUint32(fdPtr, fd, true);
		return WASI_ERRNO_SUCCESS;
	}

	private path_filestat_get(fd: number, pathPtr: number, pathLen: number, bufPtr: number): number {
		const entry = this.fds.get(fd);
		if (!entry) return WASI_ERRNO_BADF;

		const relPath = this.readString(pathPtr, pathLen);
		const fullPath = entry.path === '/' ? `/${relPath}` : `${entry.path}/${relPath}`;
		const normalized = fullPath.replace(/\/+/g, '/');

		const view = this.view();
		for (let i = 0; i < 64; i++) view.setUint8(bufPtr + i, 0);

		if (this.fs.isDirectory(normalized)) {
			view.setUint8(bufPtr + 16, WASI_FILETYPE_DIRECTORY);
			return WASI_ERRNO_SUCCESS;
		}

		const file = this.fs.getFile(normalized);
		if (!file) return WASI_ERRNO_NOENT;

		view.setUint8(bufPtr + 16, WASI_FILETYPE_REGULAR_FILE);
		view.setBigUint64(bufPtr + 32, BigInt(file.content.length), true);
		return WASI_ERRNO_SUCCESS;
	}

	private proc_exit(code: number): void {
		this.onExit(code);
	}

	private args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
		const view = this.view();
		view.setUint32(argcPtr, this.args.length, true);
		const totalSize = this.args.reduce((sum, arg) =>
			sum + new TextEncoder().encode(arg).length + 1, 0);
		view.setUint32(argvBufSizePtr, totalSize, true);
		return WASI_ERRNO_SUCCESS;
	}

	private args_get(argvPtr: number, argvBufPtr: number): number {
		const view = this.view();
		const bytes = this.bytes();
		let bufOffset = argvBufPtr;

		for (let i = 0; i < this.args.length; i++) {
			view.setUint32(argvPtr + i * 4, bufOffset, true);
			const encoded = new TextEncoder().encode(this.args[i]);
			bytes.set(encoded, bufOffset);
			bytes[bufOffset + encoded.length] = 0; // null terminator
			bufOffset += encoded.length + 1;
		}

		return WASI_ERRNO_SUCCESS;
	}
}
