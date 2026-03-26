# Manual Test Programs

Paste each program into the **Custom** tab and step through. Expected values are in comments.

---

## 1. Scalar Basics

### P1.1 — Integer Lifecycle

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

---

### P1.2 — Char and Casting

```c
#include <stdio.h>

int main() {
    char c = 'A';        // expect: 65
    int x = c + 1;       // expect: 66
    char d = (char)300;   // expect: 44 (300 & 0xFF, sign-extended)
    int big = 100000;
    char narrow = (char)big; // expect: -96 (truncated to 8 bits)
    return 0;
}
```

**Check:** Char stores numeric value. Cast truncation works. Large-to-small narrows correctly.

---

### P1.3 — All Compound Operators

```c
#include <stdio.h>

int main() {
    int x = 100;
    x += 10;    // 110
    x -= 20;    // 90
    x *= 3;     // 270
    x /= 9;     // 30
    x %= 7;     // 2
    x &= 255;   // 2
    x |= 16;    // 18
    x ^= 18;    // 0
    x = 8;
    x <<= 2;    // 32
    x >>= 1;    // 16
    return 0;
}
```

**Check:** Each compound op updates x correctly through the chain.

---

### P1.4 — Increment and Decrement

```c
#include <stdio.h>

int main() {
    int a = 5;
    a++;         // 6
    a++;         // 7
    ++a;         // 8
    a--;         // 7
    --a;         // 6
    int b = a;
    a++;         // a=7, b still 6
    int c = a;   // c=7
    return 0;
}
```

**Check:** Pre vs post semantics. Values update correctly at each step.

---

## 2. Structs

### P2.1 — Simple Struct

```c
#include <stdio.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point p = {10, 20};
    p.x = 30;           // expect: x=30, y=20
    p.y = p.x + 5;      // expect: x=30, y=35
    return 0;
}
```

**Check:** Struct shows as parent with `.x` and `.y` children. Values update on reassignment.

---

### P2.2 — Nested Structs

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
    p.pos.x = 50;       // expect: pos.x=50
    p.pos.y = 60;        // expect: pos.y=60
    p.id = 99;           // expect: id=99
    return 0;
}
```

**Check:** Three levels of nesting: Player > pos > x/y. All fields accessible and modifiable.

---

### P2.3 — Multiple Struct Instances

```c
#include <stdio.h>

struct Vec2 {
    int x;
    int y;
};

int main() {
    struct Vec2 a = {1, 2};
    struct Vec2 b = {3, 4};
    int cx = a.x + b.x;  // expect: cx=4
    int cy = a.y + b.y;  // expect: cy=6
    return 0;
}
```

**Check:** Multiple struct instances coexist. Cross-struct field reads work.

---

## 3. Arrays

### P3.1 — Array Init and Access

```c
#include <stdio.h>

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    arr[0] = 99;        // expect: [0]=99
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

---

### P3.2 — Array Bounds Error

```c
#include <stdio.h>

int main() {
    int arr[3] = {1, 2, 3};
    arr[5] = 100;  // expect: out-of-bounds error
    return 0;
}
```

**Check:** Error reported for index 5 on size-3 array.

---

### P3.3 — Array in Loop with Modification

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

## 4. Pointers and Heap

### P4.1 — malloc/free Lifecycle

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *p = malloc(sizeof(int));
    *p = 42;             // expect: heap value = 42
    *p = *p + 8;         // expect: heap value = 50
    free(p);             // expect: status = freed
    return 0;
}
```

**Check:** Heap section shows allocated block. Value updates. Free changes status. Stack shows `p` with hex address.

---

### P4.2 — calloc Zero-Init

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *arr = calloc(4, sizeof(int));
    // expect: 4 elements, all = 0
    arr[0] = 10;
    arr[1] = 20;
    arr[2] = 30;
    arr[3] = 40;
    free(arr);
    return 0;
}
```

**Check:** calloc shows 4 zero-initialized elements. Each assignment updates the correct element.

---

### P4.3 — Multiple Heap Blocks

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *a = malloc(sizeof(int));
    int *b = malloc(sizeof(int));
    int *c = malloc(sizeof(int));
    *a = 1;
    *b = 2;
    *c = *a + *b;       // expect: *c = 3
    free(a);
    free(b);
    free(c);
    return 0;
}
```

**Check:** Three separate heap blocks visible simultaneously. Each freed independently.

---

### P4.4 — Heap Array with Loop

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

---

### P4.5 — Heap Bounds Error

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

## 5. Struct + Pointer Combos

### P5.1 — Heap Struct via Pointer

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

---

### P5.2 — Struct with Pointer Member

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

---

### P5.3 — Full "Memory Basics" Pattern

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
    // expect: msg = "dist=25"

    free(p->scores);
    free(p);
    free(msg);
    return 0;
}
```

**Check:** Flagship program. Nested struct on heap, pointer member to heap array, function call with struct-by-value, sprintf formatting, triple free.

---

## 6. Functions

### P6.1 — Simple Function Call

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

---

### P6.2 — Function with Struct Parameter

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

**Check:** Struct passed by value — callee gets a copy with same field values. Original unchanged after return.

---

### P6.3 — Multiple Function Calls

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

---

### P6.4 — Recursive Function

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

## 7. Control Flow

### P7.1 — If/Else Branching

```c
#include <stdio.h>

int main() {
    int x = 10;
    int y = 0;

    if (x > 5) {
        y = 1;
    } else {
        y = 2;
    }
    // expect: y = 1

    if (x < 5) {
        y = 10;
    } else {
        y = 20;
    }
    // expect: y = 20

    return 0;
}
```

**Check:** Correct branch executes. Steps don't show the skipped branch.

---

### P7.2 — While Loop

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

---

### P7.3 — Nested Loops

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

---

### P7.4 — Break and Continue

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

**Check:** Skips i=3 (continue), stops at i=7 (break). Sum excludes 3 and includes 0-6 minus 3.

---

## 8. Scope Lifecycle

### P8.1 — Block Scoping

```c
#include <stdio.h>

int main() {
    int x = 1;
    {
        int y = 2;
        x = x + y;     // expect: x=3
    }
    // y should be gone
    int z = x + 10;    // expect: z=13
    return 0;
}
```

**Check:** `y` appears when block entered, disappears when block exits. `x` persists across blocks.

---

### P8.2 — Variable Shadowing

```c
#include <stdio.h>

int main() {
    int x = 10;
    {
        int x = 20;     // shadows outer x
        x = x + 5;      // expect: inner x = 25
    }
    // expect: outer x still = 10
    int y = x;           // expect: y = 10
    return 0;
}
```

**Check:** Inner `x` is separate from outer `x`. After block, outer `x` is unchanged.

---

## 9. sprintf and Strings

### P9.1 — sprintf Format Specifiers

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    char *buf = malloc(128);

    sprintf(buf, "hello world");
    // expect: "hello world"

    sprintf(buf, "x=%d", 42);
    // expect: "x=42"

    sprintf(buf, "hex=%x", 255);
    // expect: "hex=ff"

    sprintf(buf, "char=%c", 65);
    // expect: "char=A"

    sprintf(buf, "100%%");
    // expect: "100%"

    sprintf(buf, "%d+%d=%d", 1, 2, 3);
    // expect: "1+2=3"

    free(buf);
    return 0;
}
```

**Check:** Each sprintf overwrites buf with formatted string. All format specifiers render correctly.

---

## 10. Error Cases

### P10.1 — Division by Zero

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

---

### P10.2 — Syntax Error (Missing Semicolon)

```c
#include <stdio.h>

int main() {
    int x = 10
    int y = 20;
    return 0;
}
```

**Check:** Missing semicolon detected and reported.

---

### P10.3 — Memory Leak Detection

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *a = malloc(sizeof(int));
    int *b = malloc(sizeof(int));
    *a = 1;
    *b = 2;
    free(a);
    // b not freed
    return 0;
}
```

**Check:** `a`'s block shows as freed. `b`'s block shows as leaked at program end.

---

## 11. Integration — Complex Programs

### P11.1 — Linked List Nodes

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

---

### P11.2 — Matrix Operations

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int rows = 3;
    int *matrix = calloc(rows * rows, sizeof(int));

    for (int i = 0; i < rows; i++) {
        matrix[i * rows + i] = 1;
    }
    // expect: {1,0,0, 0,1,0, 0,0,1}

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

---

### P11.3 — Ternary Operator

```c
#include <stdio.h>

int main() {
    int x = 10;
    int y = x > 5 ? 100 : 200;   // expect: y = 100
    int z = x < 5 ? 100 : 200;   // expect: z = 200
    return 0;
}
```

**Check:** Ternary evaluates correct branch.

---

### P11.4 — Do-While Loop

```c
#include <stdio.h>

int main() {
    int x = 1;
    do {
        x = x * 2;
    } while (x < 100);
    // expect: x = 128 (1->2->4->8->16->32->64->128)
    return 0;
}
```

**Check:** Loop body executes at least once. Final value correct.

---

### P11.5 — Fibonacci with Array

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int n = 8;
    int *fib = calloc(n, sizeof(int));
    fib[0] = 0;
    fib[1] = 1;
    for (int i = 2; i < n; i++) {
        fib[i] = fib[i - 1] + fib[i - 2];
    }
    // expect: {0, 1, 1, 2, 3, 5, 8, 13}
    free(fib);
    return 0;
}
```

**Check:** Fibonacci sequence builds correctly. Each element reads two prior elements.

---

### P11.6 — Compound Ops on Struct Fields

```c
#include <stdio.h>
#include <stdlib.h>

struct Stats {
    int health;
    int armor;
};

int main() {
    struct Stats *s = malloc(sizeof(struct Stats));
    s->health = 100;
    s->armor = 50;
    s->health -= 30;    // expect: 70
    s->armor += 10;     // expect: 60
    s->health -= 20;    // expect: 50
    free(s);
    return 0;
}
```

**Check:** Compound assignment on struct fields through pointer works correctly.

---

### P11.7 — Array Element Increment

```c
#include <stdio.h>

int main() {
    int arr[3] = {10, 20, 30};
    arr[0]++;    // expect: 11
    arr[1]++;    // expect: 21
    arr[2]++;    // expect: 31
    return 0;
}
```

**Check:** Post-increment on array elements updates in place.

---

### P11.8 — Dereference Assignment

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *p = malloc(sizeof(int));
    *p = 42;             // expect: heap value = 42
    *p = *p + 8;         // expect: heap value = 50
    *p = 0;              // expect: heap value = 0
    free(p);
    return 0;
}
```

**Check:** Dereference writes update heap block value correctly.

---

## 12. Advanced Integration

### P12.1 — Bubble Sort

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int arr[5] = {5, 3, 1, 4, 2};
    for (int i = 0; i < 4; i++) {
        for (int j = 0; j < 4 - i; j++) {
            if (arr[j] > arr[j + 1]) {
                int tmp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = tmp;
            }
        }
    }
    // expect: {1, 2, 3, 4, 5}
    return 0;
}
```

**Check:** Array elements are sorted after nested loop passes. Swap via temp variable works.

---

### P12.2 — Multi-Function Program

```c
#include <stdio.h>
#include <stdlib.h>

int max(int a, int b) {
    if (a > b) { return a; }
    return b;
}

int clamp(int val, int lo, int hi) {
    return max(lo, val > hi ? hi : val);
}

int main() {
    int a = clamp(15, 0, 10);   // expect: 10
    int b = clamp(-5, 0, 10);   // expect: 0
    int c = clamp(5, 0, 10);    // expect: 5
    return 0;
}
```

**Check:** Functions call each other. Ternary inside function args. Return values chain correctly.

---

### P12.3 — Memory Pool Pattern

```c
#include <stdio.h>
#include <stdlib.h>

int main() {
    int n = 4;
    int *blocks[4];
    for (int i = 0; i < n; i++) {
        blocks[i] = malloc(sizeof(int));
        *blocks[i] = (i + 1) * 100;
    }
    // expect: 4 heap blocks with values 100, 200, 300, 400

    int sum = 0;
    for (int i = 0; i < n; i++) {
        sum += *blocks[i];
    }
    // expect: sum = 1000

    for (int i = 0; i < n; i++) {
        free(blocks[i]);
    }
    // expect: all 4 blocks freed
    return 0;
}
```

**Check:** Array of pointers, each pointing to heap. All allocated, summed, then freed.

---

### P12.4 — Early Return from Nested Context

```c
#include <stdio.h>

int search(int target) {
    for (int i = 0; i < 5; i++) {
        if (i == target) {
            return i * i;
        }
    }
    return -1;
}

int main() {
    int a = search(3);    // expect: 9
    int b = search(10);   // expect: -1
    return 0;
}
```

**Check:** Function returns from inside a for-loop. Not-found case returns -1.

---

### P12.5 — Recursive Fibonacci

```c
#include <stdio.h>

int fib(int n) {
    if (n <= 0) { return 0; }
    if (n == 1) { return 1; }
    return fib(n - 1) + fib(n - 2);
}

int main() {
    int a = fib(0);    // expect: 0
    int b = fib(1);    // expect: 1
    int c = fib(6);    // expect: 8
    return 0;
}
```

**Check:** Recursive calls with two branches. Multiple stack frames build up. Correct fibonacci values.
