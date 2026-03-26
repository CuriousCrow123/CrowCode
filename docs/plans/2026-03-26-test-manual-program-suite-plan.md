---
title: Manual Visual Test Suite — Full C Programs for Custom Tab
type: test
status: active
date: 2026-03-26
---

# Manual Visual Test Suite — Full C Programs for Custom Tab

## Context

The automated test suite (463 tests in `value-correctness.test.ts`) validates values programmatically but doesn't catch **visual** issues — wrong display formatting, missing entries, confusing step descriptions, UI glitches in the ProgramStepper. The user needs a set of complete C programs to paste into the Custom tab and manually review the memory visualization output.

## Design

Create a collection of self-contained C programs organized by feature category. Each program:
- Is a complete `main()` with `#include` headers
- Exercises a specific combination of C features
- Produces interesting, verifiable memory states at each step
- Has inline comments describing what the user should see

Programs are stored as a markdown document with copy-paste-ready code blocks and expected observations.

## Programs

### Category 1: Scalar Basics
**What to verify:** Variable values display correctly, assignments update in real-time

#### P1.1 — Integer Lifecycle
```c
#include <stdio.h>

int main() {
    int a = 42;
    int b = -7;
    int c = a + b;      // expect: c = 35
    c *= 2;             // expect: c = 70
    c %= 9;             // expect: c = 7
    int d = c << 3;     // expect: d = 56
    d = d >> 1;         // expect: d = 28
    d = ~d;             // expect: d = -29
    return 0;
}
```
**Check:** Each step shows correct value. Bitwise ops produce correct results. Negative numbers display properly.

#### P1.2 — Char and Casting
```c
#include <stdio.h>

int main() {
    char c = 'A';       // expect: 65
    int x = c + 1;      // expect: 66
    char d = (char)300;  // expect: 44 (300 & 0xFF, sign-extended)
    int big = 100000;
    char narrow = (char)big; // expect: -96 (truncated)
    return 0;
}
```
**Check:** Char stores numeric value. Cast truncation works. Large-to-small narrows correctly.

#### P1.3 — All Compound Operators
```c
#include <stdio.h>

int main() {
    int x = 100;
    x += 10;   // 110
    x -= 20;   // 90
    x *= 3;    // 270
    x /= 9;    // 30
    x %= 7;    // 2
    x &= 0xFF; // 2
    x |= 0x10; // 18
    x ^= 0x12; // 8
    x <<= 2;   // 32
    x >>= 1;   // 16
    return 0;
}
```
**Check:** Each compound op updates x correctly through the chain.

#### P1.4 — Increment/Decrement
```c
#include <stdio.h>

int main() {
    int a = 5;
    a++;        // 6
    a++;        // 7
    ++a;        // 8
    a--;        // 7
    --a;        // 6
    int b = a++;  // b=6, a=7
    int c = ++a;  // c=8, a=8
    return 0;
}
```
**Check:** Pre vs post semantics visible in assigned values.

---

### Category 2: Structs
**What to verify:** Struct fields display as children, nested structs indent properly

#### P2.1 — Simple Struct
```c
#include <stdio.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point p = {10, 20};
    p.x = 30;          // expect: x=30, y=20
    p.y = p.x + 5;     // expect: x=30, y=35
    return 0;
}
```
**Check:** Struct shows as parent with `.x` and `.y` children. Values update on reassignment.

#### P2.2 — Nested Structs
```c
#include <stdio.h>

struct Point {
    int x;
    int y;
};

struct Player {
    int id;
    struct Point pos;
};

int main() {
    struct Player p = {1, {10, 20}};
    p.pos.x = 50;      // expect: pos.x=50
    p.pos.y = 60;      // expect: pos.y=60
    p.id = 99;         // expect: id=99
    return 0;
}
```
**Check:** Three levels of nesting: Player → pos → x/y. All fields accessible and modifiable.

#### P2.3 — Multiple Structs
```c
#include <stdio.h>

struct Vec2 {
    int x;
    int y;
};

int main() {
    struct Vec2 a = {1, 2};
    struct Vec2 b = {3, 4};
    struct Vec2 c = {a.x + b.x, a.y + b.y};  // expect: c = {4, 6}
    a = c;              // full struct copy? or field-by-field?
    return 0;
}
```
**Check:** Multiple struct instances coexist. Cross-struct field reads work.

---

### Category 3: Arrays
**What to verify:** Array elements show as indexed children, bounds checking works

#### P3.1 — Array Init and Access
```c
#include <stdio.h>

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    arr[0] = 99;       // expect: [0]=99
    arr[4] = arr[0] + arr[1]; // expect: [4]=119
    int sum = 0;
    for (int i = 0; i < 5; i++) {
        sum += arr[i];
    }
    // expect: sum = 99+20+30+40+119 = 308
    return 0;
}
```
**Check:** Array shows 5 indexed children. Loop accumulates correctly.

#### P3.2 — Array Bounds Error
```c
#include <stdio.h>

int main() {
    int arr[3] = {1, 2, 3};
    arr[5] = 100;  // expect: out-of-bounds error
    return 0;
}
```
**Check:** Error reported for index 5 on size-3 array.

#### P3.3 — Array in Loop with Modification
```c
#include <stdio.h>

int main() {
    int data[4] = {1, 2, 3, 4};
    for (int i = 0; i < 4; i++) {
        data[i] = data[i] * data[i];
    }
    // expect: {1, 4, 9, 16}
    int total = 0;
    for (int i = 0; i < 4; i++) {
        total += data[i];
    }
    // expect: total = 30
    return 0;
}
```
**Check:** Array elements update in-place during loop. Second loop reads updated values.

---

### Category 4: Pointers and Heap
**What to verify:** Heap blocks appear in heap section, pointer values show as hex addresses, free marks as freed

#### P4.1 — malloc/free Lifecycle
```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *p = malloc(sizeof(int));
    *p = 42;            // expect: heap block value = 42
    *p = *p + 8;        // expect: heap block value = 50
    free(p);            // expect: heap block status = freed
    return 0;
}
```
**Check:** Heap section shows allocated block. Value updates. Free changes status. Stack shows `p` with hex address.

#### P4.2 — calloc Zero-Init
```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *arr = calloc(4, sizeof(int));
    // expect: all 4 elements = 0
    arr[0] = 10;
    arr[1] = 20;
    arr[2] = 30;
    arr[3] = 40;
    free(arr);
    return 0;
}
```
**Check:** calloc shows 4 zero-initialized elements. Each assignment updates the correct element.

#### P4.3 — Multiple Heap Blocks
```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *a = malloc(sizeof(int));
    int *b = malloc(sizeof(int));
    int *c = malloc(sizeof(int));
    *a = 1;
    *b = 2;
    *c = *a + *b;      // expect: *c = 3
    free(a);            // expect: a's block freed
    free(b);            // expect: b's block freed
    free(c);            // expect: c's block freed
    return 0;
}
```
**Check:** Three separate heap blocks visible simultaneously. Each freed independently.

#### P4.4 — Heap Array with Loop
```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int n = 5;
    int *squares = malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) {
        squares[i] = i * i;
    }
    // expect: {0, 1, 4, 9, 16}
    free(squares);
    return 0;
}
```
**Check:** Heap array elements populate one by one during loop. All values visible before free.

#### P4.5 — Heap Bounds Error
```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *arr = calloc(3, sizeof(int));
    arr[0] = 1;
    arr[1] = 2;
    arr[2] = 3;
    arr[5] = 100;  // expect: heap buffer overflow error
    free(arr);
    return 0;
}
```
**Check:** Out-of-bounds write to heap array is caught.

---

### Category 5: Struct + Pointer Combos
**What to verify:** Heap structs show fields, arrow operator works, nested heap access chains work

#### P5.1 — Heap Struct via Pointer
```c
#include <stdio.h>
#include <stdlib.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point *p = malloc(sizeof(struct Point));
    p->x = 10;
    p->y = 20;
    p->x = p->x + p->y;  // expect: x=30
    free(p);
    return 0;
}
```
**Check:** Heap struct shows `.x` and `.y` children. Arrow operator writes work. Values update.

#### P5.2 — Struct with Pointer Member
```c
#include <stdio.h>
#include <stdlib.h>

struct Player {
    int id;
    int *scores;
};

int main() {
    struct Player p;
    p.id = 1;
    p.scores = calloc(3, sizeof(int));
    p.scores[0] = 100;
    p.scores[1] = 200;
    p.scores[2] = 300;
    free(p.scores);
    return 0;
}
```
**Check:** Stack struct has `id` and `scores` fields. `scores` points to heap array. Array elements accessible through struct member.

#### P5.3 — Full "Memory Basics" Pattern
```c
#include <stdio.h>
#include <stdlib.h>

struct Point {
    int x;
    int y;
};

struct Player {
    int id;
    struct Point pos;
    int *scores;
};

int distance(struct Point a, struct Point b) {
    int dx = a.x - b.x;
    int dy = a.y - b.y;
    return dx * dx + dy * dy;
}

int main() {
    struct Point origin = {0, 0};
    struct Player *p = malloc(sizeof(struct Player));
    p->id = 1;
    p->pos.x = 3;
    p->pos.y = 4;
    p->scores = calloc(3, sizeof(int));
    p->scores[0] = 100;
    p->scores[1] = 200;
    p->scores[2] = 300;

    int d = distance(origin, p->pos);
    // expect: d = 25 (3*3 + 4*4)

    char *msg = malloc(64);
    sprintf(msg, "dist=%d", d);
    // expect: msg value = "dist=25"

    free(p->scores);
    free(p);
    free(msg);
    return 0;
}
```
**Check:** This is the flagship program. Nested struct on heap, pointer member to heap array, function call with struct-by-value, sprintf formatting, triple free. Everything should display correctly.

---

### Category 6: Functions
**What to verify:** New stack frame appears, parameters visible, return value assigned, frame cleaned up

#### P6.1 — Simple Function Call
```c
#include <stdio.h>

int add(int a, int b) {
    int result = a + b;
    return result;
}

int main() {
    int x = add(10, 20);  // expect: x = 30
    int y = add(x, 5);    // expect: y = 35
    return 0;
}
```
**Check:** During `add()` call, new frame shows `a`, `b`, `result`. After return, frame disappears and result assigned.

#### P6.2 — Function with Struct Parameter
```c
#include <stdio.h>

struct Point {
    int x;
    int y;
};

int magnitude(struct Point p) {
    return p.x * p.x + p.y * p.y;
}

int main() {
    struct Point a = {3, 4};
    int m = magnitude(a);  // expect: m = 25
    return 0;
}
```
**Check:** Struct passed by value — callee gets a copy with same field values. Original unchanged.

#### P6.3 — Multiple Function Calls
```c
#include <stdio.h>

int square(int n) {
    return n * n;
}

int cube(int n) {
    return n * n * n;
}

int main() {
    int a = square(3);   // expect: 9
    int b = cube(3);     // expect: 27
    int c = square(b);   // expect: 729
    return 0;
}
```
**Check:** Each call creates/destroys its own frame. Return values chain correctly.

#### P6.4 — Recursive Function
```c
#include <stdio.h>

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main() {
    int result = factorial(5);  // expect: 120
    return 0;
}
```
**Check:** Multiple stack frames visible simultaneously during recursion. Frames unwind correctly.

---

### Category 7: Control Flow
**What to verify:** Correct branches taken, loop iterations visible, scope cleanup

#### P7.1 — If/Else Branching
```c
#include <stdio.h>

int main() {
    int x = 10;
    int y = 0;

    if (x > 5) {
        y = 1;          // expect: this branch taken
    } else {
        y = 2;
    }
    // expect: y = 1

    if (x < 5) {
        y = 10;
    } else {
        y = 20;         // expect: this branch taken
    }
    // expect: y = 20

    return 0;
}
```
**Check:** Correct branch executes. Steps don't show the skipped branch.

#### P7.2 — While Loop
```c
#include <stdio.h>

int main() {
    int n = 5;
    int sum = 0;
    while (n > 0) {
        sum += n;
        n--;
    }
    // expect: sum = 15, n = 0
    return 0;
}
```
**Check:** Loop iterates 5 times. `sum` accumulates 5+4+3+2+1=15. `n` decrements to 0.

#### P7.3 — Nested Loops
```c
#include <stdio.h>

int main() {
    int total = 0;
    for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 3; j++) {
            total += 1;
        }
    }
    // expect: total = 9
    return 0;
}
```
**Check:** Inner loop variable `j` created/destroyed each outer iteration. Total accumulates to 9.

#### P7.4 — Break and Continue
```c
#include <stdio.h>

int main() {
    int sum = 0;
    for (int i = 0; i < 10; i++) {
        if (i == 3) {
            continue;
        }
        if (i == 7) {
            break;
        }
        sum += i;
    }
    // expect: sum = 0+1+2+4+5+6 = 18
    return 0;
}
```
**Check:** Skips i=3 (continue), stops at i=7 (break). Sum excludes 3 and 7+.

---

### Category 8: Scope Lifecycle
**What to verify:** Variables appear/disappear with their scope, shadowing works

#### P8.1 — Block Scoping
```c
#include <stdio.h>

int main() {
    int x = 1;
    {
        int y = 2;
        x = x + y;    // expect: x=3
    }
    // y should be gone here
    int z = x + 10;   // expect: z=13
    return 0;
}
```
**Check:** `y` appears when block entered, disappears when block exits. `x` persists across blocks.

#### P8.2 — Variable Shadowing
```c
#include <stdio.h>

int main() {
    int x = 10;
    {
        int x = 20;    // shadows outer x
        x = x + 5;     // expect: inner x = 25
    }
    // expect: outer x still = 10
    return 0;
}
```
**Check:** Inner `x` is separate from outer `x`. After block, outer `x` is unchanged.

---

### Category 9: sprintf and Strings
**What to verify:** String values display in heap, format specifiers produce correct output

#### P9.1 — sprintf Formats
```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    char *buf = malloc(128);
    sprintf(buf, "hello world");
    // expect: buf = "hello world"

    sprintf(buf, "x=%d", 42);
    // expect: buf = "x=42"

    sprintf(buf, "hex=%x", 255);
    // expect: buf = "hex=ff"

    sprintf(buf, "char=%c", 65);
    // expect: buf = "char=A"

    sprintf(buf, "100%%");
    // expect: buf = "100%"

    sprintf(buf, "%d+%d=%d", 1, 2, 3);
    // expect: buf = "1+2=3"

    free(buf);
    return 0;
}
```
**Check:** Each sprintf overwrites buf with formatted string. All format specifiers render correctly.

---

### Category 10: Error Cases
**What to verify:** Errors reported clearly, program doesn't crash

#### P10.1 — Division by Zero
```c
#include <stdio.h>

int main() {
    int x = 10;
    int y = 0;
    int z = x / y;  // expect: error
    return 0;
}
```
**Check:** Division by zero error reported.

#### P10.2 — Syntax Error
```c
#include <stdio.h>

int main() {
    int x = 10
    int y = 20;
    return 0;
}
```
**Check:** Missing semicolon detected and reported.

#### P10.3 — Memory Leak Detection
```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *a = malloc(sizeof(int));
    int *b = malloc(sizeof(int));
    *a = 1;
    *b = 2;
    free(a);
    // b not freed — expect: leaked status
    return 0;
}
```
**Check:** `a`'s block shows as freed. `b`'s block shows as leaked at program end.

---

### Category 11: Integration — Complex Programs
**What to verify:** All features work together in realistic programs

#### P11.1 — Linked List (manual)
```c
#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    int next;
};

int main() {
    struct Node *n1 = malloc(sizeof(struct Node));
    struct Node *n2 = malloc(sizeof(struct Node));
    struct Node *n3 = malloc(sizeof(struct Node));

    n1->value = 10;
    n2->value = 20;
    n3->value = 30;

    n1->next = 0;
    n2->next = 0;
    n3->next = 0;

    free(n3);
    free(n2);
    free(n1);
    return 0;
}
```
**Check:** Three heap structs visible simultaneously. Each has `value` and `next` fields. All freed correctly.

#### P11.2 — Matrix Operations
```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int rows = 3;
    int *matrix = calloc(rows * rows, sizeof(int));

    // Fill identity-like pattern
    for (int i = 0; i < rows; i++) {
        matrix[i * rows + i] = 1;
    }
    // expect: {1,0,0, 0,1,0, 0,0,1}

    // Sum all elements
    int sum = 0;
    for (int i = 0; i < rows * rows; i++) {
        sum += matrix[i];
    }
    // expect: sum = 3

    free(matrix);
    return 0;
}
```
**Check:** 9-element heap array. Diagonal elements set to 1. Sum accumulates correctly.

#### P11.3 — Ternary and Comma Operators
```c
#include <stdio.h>

int main() {
    int x = 10;
    int y = x > 5 ? 100 : 200;  // expect: y = 100
    int z = x < 5 ? 100 : 200;  // expect: z = 200
    return 0;
}
```
**Check:** Ternary evaluates correct branch.

#### P11.4 — Do-While Loop
```c
#include <stdio.h>

int main() {
    int x = 1;
    do {
        x = x * 2;
    } while (x < 100);
    // expect: x = 128 (1→2→4→8→16→32→64→128)
    return 0;
}
```
**Check:** Loop body executes at least once. Final value correct.

## Files

### Create
| File | Purpose |
|------|---------|
| `docs/test-programs.md` | Collection of all test programs with expected observations |

## Steps

### Step 1: Write test programs document
- **What:** Create `docs/test-programs.md` with all programs from this plan, organized by category
- **Files:** `docs/test-programs.md`
- **Verification:** All code blocks are syntactically valid C

## Verification
- [ ] Each program compiles conceptually (valid C subset)
- [ ] Expected values documented for every step
- [ ] Programs cover all supported C features
- [ ] Edge cases included (errors, bounds, leaks)
