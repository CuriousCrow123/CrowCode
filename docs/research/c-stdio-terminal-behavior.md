# How C stdio Works with Real Terminals

Comprehensive reference covering buffering, scanf, terminal line discipline, and common pitfalls.
Sources: Linux man pages (man7.org), POSIX.1-2008, glibc documentation, Stevens APUE.

---

## 1. Buffering Modes

The C standard library provides three buffering modes for streams (from `setbuf(3)`):

| Mode | Constant | Behavior |
|------|----------|----------|
| Unbuffered | `_IONBF` | Data written immediately to destination — no internal buffer |
| Line-buffered | `_IOLBF` | Data buffered until a newline is written, OR input is read from any terminal-attached stream (typically stdin) |
| Fully-buffered | `_IOFBF` | Data buffered until the internal buffer fills up (typically 4096 or 8192 bytes) |

### Default modes by stream

| Stream | Connected to terminal | Redirected to pipe/file |
|--------|----------------------|------------------------|
| `stdout` | **Line-buffered** | **Fully-buffered** |
| `stderr` | **Unbuffered** | **Unbuffered** |
| `stdin` | **Line-buffered** | **Fully-buffered** |

From `setbuf(3)`: "Normally all files are block buffered. If a stream refers to a terminal (as stdout normally does), it is line buffered. The standard error stream stderr is always unbuffered by default."

### Line-buffering and printf

When stdout is line-buffered (the normal terminal case):

```c
printf("Hello, world!\n");  // Flushes immediately — the \n triggers the flush
printf("Enter a number: "); // Does NOT flush yet — no \n in the string
```

However, there is a critical rule from the C standard and POSIX: **when input is read from a terminal-attached stream, all line-buffered output streams are flushed first**. This means:

```c
printf("Enter a number: ");  // No \n — stays in buffer
scanf("%d", &x);             // Before reading stdin, stdout is flushed
                             // So "Enter a number: " DOES appear before scanf blocks
```

This is specified in the `setbuf(3)` man page: "characters are saved up until a newline is output **or input is read from any stream attached to a terminal device (typically stdin)**."

### fflush(stdout)

`fflush(3)` forces all buffered data for the given stream to be written. It is needed when:

1. You want output to appear immediately without a newline
2. stdout is redirected to a pipe (fully-buffered, so no auto-flush before scanf)
3. You want to guarantee output appears before a `fork()`, `exec()`, or `_exit()`

```c
printf("Progress: 50%%");
fflush(stdout);  // Force "Progress: 50%" to appear now
```

### The classic pitfall

```c
printf("Enter a number: ");  // No \n
scanf("%d", &x);
```

**On a terminal:** This works fine. The line-buffering rule flushes stdout before reading stdin.

**Through a pipe (e.g., `echo 42 | ./program`):** stdout is fully-buffered. The prompt may never appear (or appear only after the buffer fills up or the program exits). This is why defensive code uses `fflush(stdout)` after prompts.

---

## 2. scanf Behavior in Detail

From `scanf(3)` and `sscanf(3)`:

### How scanf("%d", &x) reads input

1. **Skip leading whitespace.** The `%d` specifier (like most specifiers) skips any leading spaces, tabs, newlines.
2. **Read characters matching the conversion.** For `%d`, it reads an optional sign followed by decimal digits.
3. **Stop at the first non-matching character.** That character remains in the input buffer (it is "pushed back").

```c
// Input stream contains: "  42\n"
scanf("%d", &x);
// Skips "  ", reads "42", stops at '\n'
// x = 42
// '\n' remains in the input buffer
```

### Return values

From `scanf(3)`:
- Returns the **number of items successfully matched and assigned**
- Returns `0` if the first conversion fails (input present but doesn't match)
- Returns `EOF` (-1) if end-of-input is reached before any conversion or matching failure

```c
int x, y;
int ret;

// Input: "42\n"
ret = scanf("%d", &x);      // ret = 1, x = 42

// Input: "abc\n"
ret = scanf("%d", &x);      // ret = 0 — 'a' doesn't match %d, 'a' stays in buffer

// Input: EOF (Ctrl+D on empty line)
ret = scanf("%d", &x);      // ret = EOF (-1)
```

### The \n residue problem

This is the single most common scanf pitfall for students:

```c
int n;
char c;
scanf("%d", &n);   // Input: "42\n" — reads "42", leaves '\n' in buffer
scanf("%c", &c);   // %c does NOT skip whitespace — reads the leftover '\n'
                   // c = '\n', NOT the next character the user types
```

Why: The `%c` specifier is special — it does **not** skip leading whitespace (unlike `%d`, `%s`, `%f`, etc.). From `sscanf(3)`: "%c matches a sequence of characters... The usual skip of leading white space is suppressed."

Fix: add a space before `%c`:
```c
scanf(" %c", &c);  // The space means "skip any whitespace", then read one char
```

### scanf("%d %d") with input "10 20\n"

```c
int a, b;
scanf("%d %d", &a, &b);
// 1. Skip whitespace (none), read "10" into a. Stop at ' '.
// 2. The space in format = "skip any whitespace". Consumes the ' '.
// 3. Read "20" into b. Stop at '\n'.
// Result: a=10, b=20, '\n' remains in buffer
// Return value: 2
```

### Partial input — format expects two numbers

```c
int a, b;
// User types "10\n" and that's all that's available so far
int ret = scanf("%d %d", &a, &b);
// 1. Reads "10" into a.
// 2. Hits '\n' — whitespace directive in format, skips it.
// 3. Now needs digits for %d — no input available.
// 4. scanf BLOCKS, waiting for more input from terminal.
// User types "20\n"
// 5. Reads "20" into b.
// ret = 2
```

Key insight: **scanf does not return until the format is satisfied or a matching failure occurs**. The whitespace directive between `%d` specifiers consumes newlines, so scanf keeps waiting for the next number.

### scanf with %s

From `sscanf(3)`: "%s matches a sequence of non-white-space characters."

```c
char name[100];
scanf("%s", name);
// Input: "  Hello World\n"
// Skips leading spaces, reads "Hello", stops at space
// name = "Hello", " World\n" remains in buffer
```

**Buffer overflow danger:** `%s` has no limit on how many characters it reads. If the user types 200 characters with no whitespace, it overflows a 100-byte buffer. Fix: use width specifier:

```c
scanf("%99s", name);  // Reads at most 99 chars, leaving room for '\0'
```

---

## 3. getchar / putchar

### getchar() and line discipline

`getchar()` is equivalent to `fgetc(stdin)` (from `fgetc(3)`). It returns one character as an `unsigned char` cast to `int`, or `EOF` on end-of-file or error.

**Critical point:** Even though `getchar()` returns a single character, the **terminal line discipline** means the user must press Enter before any characters are delivered to the program.

```c
int c = getchar();
// Terminal is in canonical mode (default).
// User types 'H', 'i', Enter.
// The terminal driver buffers "Hi\n" until Enter.
// Only THEN does getchar() return 'H'.
// 'i' and '\n' remain in stdin's buffer for subsequent reads.
```

The program never sees individual keystrokes in real time. The terminal driver handles all the buffering and echoing.

### putchar and buffering

`putchar(c)` is equivalent to `putc(c, stdout)` (from `puts(3)`). It inherits stdout's buffering mode:

- **Terminal:** line-buffered. `putchar('A')` goes into the buffer. It appears on screen when:
  - A `'\n'` is written
  - `fflush(stdout)` is called
  - stdin is read (triggering line-buffer flush)
  - The buffer fills up
- **Pipe/file:** fully-buffered. Characters accumulate until 4K/8K buffer fills.

### EOF from getchar()

`getchar()` returns `EOF` (which is -1, defined in `<stdio.h>`) when:

- **Ctrl+D on Unix** (on an empty line): The terminal sends EOF to the process. `read(2)` returns 0 bytes, stdio interprets this as end-of-file.
- **Ctrl+Z on Windows**: Same effect on Windows terminals.
- **Redirected file reaches end**: `./program < input.txt` — when all bytes are consumed.

**This is why you must use `int`, not `char`, for getchar's return:**

```c
int c;              // CORRECT — can hold EOF (-1) distinct from valid chars
while ((c = getchar()) != EOF) {
    putchar(c);
}

char c;             // WRONG — if char is unsigned, EOF (cast to 255) != -1
                    // If char is signed, (char)255 == -1, false EOF on byte 0xFF
```

---

## 4. Terminal Echo and Line Discipline

### Who echoes characters?

When a user types at a terminal, the **terminal driver** (kernel) echoes the characters, not the program. The program's process is typically blocked in a `read()` system call and has no involvement in the echoing.

From `termios(3)`, the `ECHO` flag in `c_lflag`: "Echo input characters."

### Canonical mode (the default)

Terminals default to **canonical mode** (`ICANON` set in `c_lflag`). From `termios(3)`:

> "In canonical mode: Input is made available line by line. An input line is available when one of the line delimiters is typed (NL, EOL, EOL2; or EOF at the start of line). Except in the case of EOF, the line delimiter is included in the buffer returned by read(2)."

In canonical mode, the terminal driver provides:

| Feature | Description |
|---------|-------------|
| **Line buffering** | Characters accumulate until Enter (NL). Only then does `read()` return. |
| **Echo** | Each character typed appears on screen immediately (handled by the driver). |
| **Line editing** | Backspace (ERASE) deletes the previous character. Ctrl+U (KILL) deletes the whole line. |
| **Special characters** | Ctrl+C (INTR) sends SIGINT. Ctrl+D (EOF) sends end-of-file. Ctrl+Z (SUSP) sends SIGTSTP. |

The maximum line length in canonical mode is **4096 characters** (including the newline).

### Raw mode (noncanonical)

In noncanonical mode (`ICANON` unset), from `termios(3)`:

> "Input is available immediately (without the user having to type a line-delimiter character), no input processing is performed, and line editing is disabled."

Programs like `vim`, `less`, and `curses` applications use raw/noncanonical mode. Normal C programs with `scanf`/`getchar` use the default canonical mode.

### What the terminal looks like during printf + scanf

```c
printf("Name: ");
scanf("%s", name);
```

Step-by-step on a real terminal:

1. `printf("Name: ")` — text goes into stdout's line-buffer.
2. `scanf("%s", name)` — before reading stdin, C library flushes all line-buffered terminal streams. `"Name: "` appears on screen.
3. The cursor sits right after `"Name: "` on the same line, blinking.
4. User types `A`, `l`, `i`, `c`, `e` — each character is echoed immediately by the **terminal driver**. Screen now shows: `Name: Alice`
5. User presses Enter — the terminal driver delivers `"Alice\n"` to the process.
6. `scanf` reads `"Alice"`, stops at `'\n'` (whitespace), stores in `name`.

The program never "sees" the individual keystrokes `A`, `l`, `i`, `c`, `e`. It receives the complete line after Enter.

---

## 5. puts / fputs / fgets / gets

### puts vs printf

From `puts(3)`: "puts() writes the string s **and a trailing newline** to stdout."

```c
puts("Hello");       // Output: "Hello\n"  — adds \n automatically
printf("Hello");     // Output: "Hello"    — no \n unless you include it
printf("Hello\n");   // Output: "Hello\n"  — equivalent to puts("Hello")
```

`fputs()` does NOT add a newline (from `puts(3)`): "fputs() writes the string s to stream, without its terminating null byte."

```c
fputs("Hello", stdout);   // Output: "Hello"  — no \n added (like printf)
fputs("Hello\n", stdout); // Output: "Hello\n"
```

### fgets — includes the \n

From `fgetc(3)`: "fgets() reads in at most one less than `size` characters from stream and stores them into the buffer pointed to by s. Reading stops after an EOF or a newline. **If a newline is read, it is stored into the buffer.** A terminating null byte is stored after the last character."

```c
char buf[100];
fgets(buf, 100, stdin);
// User types "Hello\n"
// buf contains: "Hello\n\0"  — the \n IS included
// strlen(buf) == 6
```

### fgets with buffer smaller than input

```c
char buf[5];          // Room for 4 chars + '\0'
fgets(buf, 5, stdin);
// User types "Hello World\n"
// fgets reads at most 4 characters: "Hell"
// buf contains: "Hell\0"
// "o World\n" remains in the input buffer for subsequent reads
```

If the input fits exactly: user types "Hi\n":
```c
char buf[5];
fgets(buf, 5, stdin);
// buf contains: "Hi\n\0" — the newline is included, 3 chars + \0 fits in 5 bytes
```

### gets — dangerous, no bounds checking

From `gets(3)`: "Never use this function." and "gets() reads a line from stdin into the buffer pointed to by s until either a terminating newline or EOF, **which it replaces with a null byte**."

Key differences from fgets:

| | fgets | gets |
|---|---|---|
| Newline | Included in buffer | Replaced with '\0' (not included) |
| Buffer size | Takes `size` parameter, reads at most `size-1` chars | **No size parameter** — reads unlimited chars |
| Safety | Safe (bounded) | **Dangerous** — trivial buffer overflow |
| Status | Current standard | Removed from C11, deprecated in POSIX.1-2008 |

```c
char buf[10];
gets(buf);
// User types "Hello\n"
// buf contains: "Hello\0" — the \n is consumed but NOT stored
// If user types 20 characters: stack buffer overflow — undefined behavior
```

From the man page: "It has been used to break computer security." (See: Morris Worm, 1988.)

---

## 6. Mixed stdout/stdin Interaction

### Classic pattern step-by-step

```c
printf("Enter: ");
scanf("%d", &x);
printf("Got %d\n", x);
```

What the terminal shows (user input in angle brackets):

```
Enter: <42>
Got 42
```

Detailed sequence:

1. `printf("Enter: ")` — writes to stdout's line-buffer. No newline, so not flushed yet.
2. `scanf("%d", &x)` — C library flushes stdout (line-buffer rule). `"Enter: "` appears on screen.
3. `scanf` calls `read()` on stdin. Terminal is in canonical mode, so it blocks.
4. User types `4` — echoed by terminal driver. Screen: `Enter: 4`
5. User types `2` — echoed. Screen: `Enter: 42`
6. User presses Enter — terminal driver delivers `"42\n"` to the process.
7. `scanf` parses `"42"`, stores 42 in `x`. `'\n'` remains in stdin's buffer.
8. `printf("Got %d\n", x)` — writes `"Got 42\n"` to stdout. The `\n` triggers flush.
9. Screen: `Enter: 42\nGot 42\n`

### Multiple scanf calls — does buffered input carry over?

**Yes.** Input remaining in stdin's buffer is consumed by subsequent reads:

```c
printf("Two numbers: ");
scanf("%d", &a);    // User types "10 20\n"
scanf("%d", &b);    // Does NOT wait — reads "20" from buffer
printf("Sum: %d\n", a + b);
```

Terminal output:
```
Two numbers: 10 20
Sum: 30
```

The first `scanf` reads `"10"` and leaves `" 20\n"` in the buffer. The second `scanf` skips the space, reads `"20"`, and returns immediately without waiting for user input.

### printf between scanf calls — when does it appear?

```c
scanf("%d", &a);       // User types "10\n"
printf("Got first\n"); // Flushed immediately (has \n)
scanf("%d", &b);       // Blocks, waiting for input
printf("Got second\n");
```

Terminal:
```
10
Got first
20
Got second
```

Each `printf` with `\n` appears immediately due to line-buffering. Without `\n`, the printf would still appear before the next `scanf` (due to the line-buffer stdin-flush rule).

---

## 7. EOF Behavior

### Ctrl+D on Unix terminals

The `VEOF` character (default Ctrl+D) has nuanced behavior. From `termios(3)`:

> "End-of-file character (EOF). More precisely: this character causes the pending tty buffer to be sent to the waiting user program without waiting for end-of-line. If it is the first character of the line, the read(2) in the user program returns 0, which signifies end-of-file."

Two distinct cases:

**Ctrl+D on an empty line (nothing typed yet):**
- Terminal driver delivers 0 bytes to `read(2)`.
- C library's stdio interprets `read()` returning 0 as end-of-file.
- Sets the EOF flag on stdin.
- `scanf` returns `EOF` (-1), `getchar` returns `EOF` (-1), `fgets` returns `NULL`.

**Ctrl+D after typing some characters (non-empty line):**
- Terminal driver flushes the current buffer to the process **immediately** (without waiting for Enter).
- This is NOT an EOF — it is a "flush now" signal.
- `read()` returns the characters typed so far.
- A second Ctrl+D on the now-empty line would then signal EOF.

Example:
```
User types: H i Ctrl+D
// Terminal delivers "Hi" (no newline) to the process.
// getchar() returns 'H', then 'i'. Next getchar() blocks again.
User types: Ctrl+D (on empty line)
// NOW getchar() returns EOF.
```

### After EOF

Once EOF is signaled:
- `scanf` returns `EOF` (-1)
- `getchar` returns `EOF` (-1)
- `fgets` returns `NULL`
- The EOF flag is "sticky" — subsequent reads also return EOF.

### clearerr — un-EOF

```c
clearerr(stdin);  // Clears both the EOF flag and the error flag
```

After `clearerr(stdin)`, subsequent reads will attempt to read from the terminal again. On a real terminal, Ctrl+D EOF can be "undone" — the terminal is still open, so new input can arrive. (This is unlike a redirected file, where EOF truly means "no more bytes.")

---

## 8. Escape Sequences in Output

### Compile-time vs. runtime processing

Escape sequences in C string literals are processed **at compile time** by the C compiler. They are NOT interpreted by `printf` at runtime.

```c
printf("hello\n");
```

The compiler converts `"hello\n"` into a 6-byte string: `{ 'h', 'e', 'l', 'l', 'o', 0x0A }`. By the time `printf` runs, it just writes those 6 bytes. The `0x0A` byte is what the terminal interprets as "move to next line."

### Common escape sequences and their byte values

| Escape | Byte | Terminal interpretation |
|--------|------|----------------------|
| `\n` | `0x0A` (LF) | Move to beginning of next line (on most terminals with ONLCR, kernel translates to CR+LF) |
| `\t` | `0x09` (HT) | Advance cursor to next tab stop (every 8 columns by default) |
| `\r` | `0x0D` (CR) | Move cursor to beginning of current line (does not erase) |
| `\0` | `0x00` (NUL) | C string terminator — printf stops here. Not a terminal control. |
| `\\` | `0x5C` | Literal backslash character |
| `\"` | `0x22` | Literal double-quote character |
| `\a` | `0x07` (BEL) | Terminal bell (beep or visual flash) |
| `\b` | `0x08` (BS) | Move cursor back one position |

### How \r works (carriage return)

```c
printf("Hello\rWorld\n");
// Writes: H e l l o CR W o r l d LF
// Terminal: "Hello" appears, cursor returns to column 0, "World" overwrites "Hello"
// Final visible output: "World" (the "Hello" is overwritten)
```

### How \0 works

```c
printf("Hello\0World\n");
// printf writes "Hello" and stops at the \0 (null terminator).
// "World\n" is never written.
// This is a C string convention, not a printf feature.
```

### The terminal does the interpretation

The C program writes raw bytes to its stdout file descriptor. The terminal emulator (xterm, iTerm2, gnome-terminal, etc.) interprets those bytes:
- `0x0A` (LF) → new line
- `0x09` (HT) → next tab stop
- `0x0D` (CR) → carriage return
- `0x1B [ ...` → ANSI escape codes (colors, cursor movement, etc.)

The kernel's terminal driver may also process some bytes — for example, with `ONLCR` set in `c_oflag` (the default), a `0x0A` (LF) byte is translated to `0x0D 0x0A` (CR+LF) before reaching the terminal device.

---

## 9. What a "Console" Shows

### Interleaved stdout and user-typed text

A terminal displays a single interleaved stream of characters. Both the program's output and the user's typed input appear in chronological order on the same screen. There is no visual distinction between them.

### Who produces what

Consider this program:

```c
#include <stdio.h>
int main(void) {
    int a, b;
    printf("Enter a number: ");
    scanf("%d", &a);
    printf("Enter another: ");
    scanf("%d", &b);
    printf("Sum = %d\n", a + b);
    return 0;
}
```

The terminal shows:
```
Enter a number: 42
Enter another: 7
Sum = 49
```

Breaking down who produced each character:

| Text | Source |
|------|--------|
| `Enter a number: ` | Program's stdout (printf) |
| `42` | Terminal echo (user typed, kernel echoed) |
| newline after 42 | Terminal echo (user pressed Enter, kernel echoed) |
| `Enter another: ` | Program's stdout (printf) |
| `7` | Terminal echo (user typed) |
| newline after 7 | Terminal echo (user pressed Enter) |
| `Sum = 49` | Program's stdout (printf) |
| final newline | Program's stdout (the \n in printf) |

**The digits "42" and "7" are NOT part of the program's stdout.** They are echoed by the terminal driver. If you redirected stdout to a file (`./program > out.txt`), the file would contain:
```
Enter a number: Enter another: Sum = 49
```
The user-typed "42" and "7" would NOT appear in the file.

### Input echo does not go through stdio

The terminal driver echoes keystrokes directly to the terminal device, bypassing the program's stdout entirely. The echo happens at the kernel level. Even if the program has not yet called `read()`, typed characters appear on screen.

---

## 10. Common Pitfalls Students Encounter

### Pitfall 1: printf without \n not appearing

```c
printf("Loading...");
sleep(5);
printf("Done!\n");
```

**Expected by student:** "Loading..." appears, 5-second wait, "Done!" appears.
**Actual behavior:** Nothing for 5 seconds, then "Loading...Done!" appears all at once.

**Why:** `"Loading..."` has no `\n`, so it sits in stdout's line-buffer. When `"Done!\n"` is written, the `\n` flushes the entire buffer.

**Fix:** `fflush(stdout)` after the first printf, or add `\n`.

### Pitfall 2: scanf("%c") reading leftover \n

```c
int age;
char grade;
printf("Age: ");
scanf("%d", &age);    // User types "21\n" — reads 21, '\n' stays
printf("Grade: ");
scanf("%c", &grade);  // Reads '\n' from buffer — doesn't wait for input!
printf("Grade is: '%c'\n", grade);  // Prints a blank line
```

**Fix:** Use `" %c"` (space before %c) to skip whitespace:
```c
scanf(" %c", &grade);  // Skips the leftover \n, then reads next non-whitespace char
```

### Pitfall 3: scanf("%d") leaving \n in buffer

This is the root cause of pitfall 2. Every `scanf("%d")` call leaves the trailing `\n` in the buffer. This affects any subsequent `scanf("%c")`, `getchar()`, or `fgets()` call.

```c
scanf("%d", &x);      // Leaves '\n'
fgets(buf, 100, stdin); // Reads "\n" — appears to skip the input
```

### Pitfall 4: getchar() waiting for Enter

```c
printf("Press any key to continue...");
int c = getchar();  // Student expects this to return on keypress
```

**Actual behavior:** Terminal is in canonical mode. The user must press Enter. If user types `x` then Enter, getchar returns `'x'`, but the `'\n'` from Enter is still in the buffer.

There is no portable standard C way to do single-keypress input. It requires `termios` manipulation (Unix) or `conio.h` (Windows).

### Pitfall 5: EOF confusion

```c
while (scanf("%d", &x) != 0) {  // WRONG — should check for EOF
    sum += x;
}
```

If the user types a non-number like "abc", `scanf` returns 0 (matching failure), and the loop exits. But if the user types Ctrl+D, `scanf` returns `EOF` (-1), which is also not 0, so the loop would NOT exit.

**Correct:**
```c
while (scanf("%d", &x) == 1) {  // Check for successful conversion count
    sum += x;
}
```

### Pitfall 6: puts adds \n, printf doesn't

```c
puts("Hello");    // Prints "Hello\n"
printf("Hello");  // Prints "Hello" — no newline, cursor stays on same line
```

Students sometimes use `printf` expecting automatic newlines, or `puts` not expecting the extra newline.

### Pitfall 7: fgets includes \n, gets doesn't

```c
char name[100];
fgets(name, 100, stdin);   // User types "Alice\n"
                           // name = "Alice\n\0"
printf("Hello, %s!", name);
// Output: "Hello, Alice
// !"                        — unexpected newline in the middle
```

**Fix:** Strip the newline after fgets:
```c
name[strcspn(name, "\n")] = '\0';
```

### Summary of buffer state after common operations

| Operation | Input: `"42\n"` | After operation, buffer contains |
|-----------|-----------------|--------------------------------|
| `scanf("%d", &x)` | Reads `"42"` | `"\n"` |
| `scanf("%s", s)` | Reads `"42"` | `"\n"` |
| `scanf("%c", &c)` | Reads `'4'` | `"2\n"` |
| `fgets(buf, 100, stdin)` | Reads `"42\n"` | empty |
| `getchar()` | Reads `'4'` | `"2\n"` |
| `gets(buf)` | Reads `"42"` (strips `\n`) | empty |

---

## Quick Reference: The Full Picture

A C program talking to a terminal involves three layers:

```
                    +-----------+
                    |  Terminal  |  (xterm, iTerm2, etc.)
                    |  Emulator  |  Interprets bytes (LF, TAB, ANSI codes)
                    +-----+-----+  Sends keystrokes to kernel
                          |
                    +-----+-----+
                    |  Terminal  |  Kernel's tty driver
                    |   Driver   |  Canonical mode: line-edit, echo, line-buffer
                    |  (kernel)  |  Ctrl+C → SIGINT, Ctrl+D → EOF
                    +-----+-----+
                          |
                    +-----+-----+
                    |   stdio    |  C library (glibc, musl, etc.)
                    |  Library   |  Buffering (line/full/none), format conversion
                    |            |  printf, scanf, fgets, getchar, etc.
                    +-----+-----+
                          |
                    +-----+-----+
                    | Your C     |
                    | Program    |
                    +------------+
```

**Output path:** Program calls `printf` → stdio buffers → `write()` syscall → kernel tty driver (ONLCR: LF→CRLF) → terminal emulator renders.

**Input path:** User types → terminal emulator sends keystrokes → kernel tty driver (echo, line-edit, canonical buffering) → `read()` syscall → stdio buffering → `scanf`/`getchar`/`fgets` returns to program.

**Key insight:** The program only interacts with the stdio library. It never directly communicates with the terminal. Two separate entities outside the program's control — the kernel's terminal driver and the terminal emulator — handle echoing, line editing, and display rendering.
