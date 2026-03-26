/** Test programs for the Custom tab dropdown. */
export interface TestProgram {
	id: string;
	name: string;
	category: string;
	source: string;
}

export const testPrograms: TestProgram[] = [
	// Category 1: Scalar Basics
	{
		id: 'p1.1', category: 'Scalars', name: 'Integer Lifecycle',
		source: `#include <stdio.h>

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
}`,
	},
	{
		id: 'p1.2', category: 'Scalars', name: 'Char and Casting',
		source: `#include <stdio.h>

int main() {
    char c = 'A';        // expect: 65
    int x = c + 1;       // expect: 66
    char d = (char)300;   // expect: 44
    int big = 100000;
    char narrow = (char)big; // expect: -96
    return 0;
}`,
	},
	{
		id: 'p1.3', category: 'Scalars', name: 'All Compound Operators',
		source: `#include <stdio.h>

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
}`,
	},
	{
		id: 'p1.4', category: 'Scalars', name: 'Increment / Decrement',
		source: `#include <stdio.h>

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
}`,
	},

	// Category 2: Structs
	{
		id: 'p2.1', category: 'Structs', name: 'Simple Struct',
		source: `#include <stdio.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point p = {10, 20};
    p.x = 30;           // expect: x=30, y=20
    p.y = p.x + 5;      // expect: x=30, y=35
    return 0;
}`,
	},
	{
		id: 'p2.2', category: 'Structs', name: 'Nested Structs',
		source: `#include <stdio.h>

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
    p.pos.x = 50;
    p.pos.y = 60;
    p.id = 99;
    return 0;
}`,
	},

	// Category 3: Arrays
	{
		id: 'p3.1', category: 'Arrays', name: 'Array Init and Loop',
		source: `#include <stdio.h>

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    arr[0] = 99;
    arr[4] = arr[0] + arr[1]; // expect: 119
    int sum = 0;
    for (int i = 0; i < 5; i++) {
        sum += arr[i];
    }
    // expect: sum = 308
    return 0;
}`,
	},
	{
		id: 'p3.3', category: 'Arrays', name: 'Array Squared in Loop',
		source: `#include <stdio.h>

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
}`,
	},

	// Category 4: Pointers and Heap
	{
		id: 'p4.1', category: 'Heap', name: 'malloc / free Lifecycle',
		source: `#include <stdio.h>
#include <stdlib.h>

int main() {
    int *p = malloc(sizeof(int));
    *p = 42;             // heap value = 42
    *p = *p + 8;         // heap value = 50
    free(p);             // status = freed
    return 0;
}`,
	},
	{
		id: 'p4.2', category: 'Heap', name: 'calloc Zero-Init',
		source: `#include <stdio.h>
#include <stdlib.h>

int main() {
    int *arr = calloc(4, sizeof(int));
    // all 4 elements = 0
    arr[0] = 10;
    arr[1] = 20;
    arr[2] = 30;
    arr[3] = 40;
    free(arr);
    return 0;
}`,
	},
	{
		id: 'p4.4', category: 'Heap', name: 'Heap Array with Loop',
		source: `#include <stdio.h>
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
}`,
	},

	// Category 5: Struct + Pointer
	{
		id: 'p5.1', category: 'Struct+Pointer', name: 'Heap Struct via Pointer',
		source: `#include <stdio.h>
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
}`,
	},
	{
		id: 'p5.3', category: 'Struct+Pointer', name: 'Full Memory Basics',
		source: `#include <stdio.h>
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
    // expect: d = 25

    char *msg = malloc(64);
    sprintf(msg, "dist=%d", d);
    // expect: msg = "dist=25"

    free(p->scores);
    free(p);
    free(msg);
    return 0;
}`,
	},

	// Category 6: Functions
	{
		id: 'p6.1', category: 'Functions', name: 'Simple Function Call',
		source: `#include <stdio.h>

int add(int a, int b) {
    int result = a + b;
    return result;
}

int main() {
    int x = add(10, 20);  // expect: 30
    int y = add(x, 5);    // expect: 35
    return 0;
}`,
	},
	{
		id: 'p6.4', category: 'Functions', name: 'Recursive Factorial',
		source: `#include <stdio.h>

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main() {
    int result = factorial(5);  // expect: 120
    return 0;
}`,
	},

	// Category 7: Control Flow
	{
		id: 'p7.1', category: 'Control Flow', name: 'If / Else Branching',
		source: `#include <stdio.h>

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
}`,
	},
	{
		id: 'p7.2', category: 'Control Flow', name: 'While Loop',
		source: `#include <stdio.h>

int main() {
    int n = 5;
    int sum = 0;
    while (n > 0) {
        sum += n;
        n--;
    }
    // expect: sum = 15, n = 0
    return 0;
}`,
	},
	{
		id: 'p7.3', category: 'Control Flow', name: 'Nested Loops',
		source: `#include <stdio.h>

int main() {
    int total = 0;
    for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 3; j++) {
            total += 1;
        }
    }
    // expect: total = 9
    return 0;
}`,
	},
	{
		id: 'p7.4', category: 'Control Flow', name: 'Break and Continue',
		source: `#include <stdio.h>

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
}`,
	},

	// Category 8: Scope
	{
		id: 'p8.2', category: 'Scope', name: 'Variable Shadowing',
		source: `#include <stdio.h>

int main() {
    int x = 10;
    {
        int x = 20;     // shadows outer x
        x = x + 5;      // inner x = 25
    }
    // outer x still = 10
    int y = x;           // expect: y = 10
    return 0;
}`,
	},

	// Category 9: sprintf
	{
		id: 'p9.1', category: 'Strings', name: 'sprintf Formats',
		source: `#include <stdio.h>
#include <stdlib.h>

int main() {
    char *buf = malloc(128);

    sprintf(buf, "hello world");
    sprintf(buf, "x=%d", 42);
    sprintf(buf, "hex=%x", 255);
    sprintf(buf, "char=%c", 65);
    sprintf(buf, "100%%");
    sprintf(buf, "%d+%d=%d", 1, 2, 3);

    free(buf);
    return 0;
}`,
	},

	// Category 10: Error Cases
	{
		id: 'p10.3', category: 'Errors', name: 'Memory Leak Detection',
		source: `#include <stdio.h>
#include <stdlib.h>

int main() {
    int *a = malloc(sizeof(int));
    int *b = malloc(sizeof(int));
    *a = 1;
    *b = 2;
    free(a);
    // b not freed — expect: leaked status
    return 0;
}`,
	},

	// Category 11+12: Integration
	{
		id: 'p11.2', category: 'Integration', name: 'Matrix Identity',
		source: `#include <stdio.h>
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
}`,
	},
	{
		id: 'p11.5', category: 'Integration', name: 'Fibonacci Array',
		source: `#include <stdio.h>
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
}`,
	},
	{
		id: 'p12.1', category: 'Integration', name: 'Bubble Sort',
		source: `#include <stdio.h>

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
}`,
	},
	{
		id: 'p12.2', category: 'Integration', name: 'Multi-Function Clamp',
		source: `#include <stdio.h>

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
}`,
	},
	{
		id: 'p12.5', category: 'Integration', name: 'Recursive Fibonacci',
		source: `#include <stdio.h>

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
}`,
	},
];

/** Get unique categories in order of appearance. */
export function getCategories(): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const p of testPrograms) {
		if (!seen.has(p.category)) {
			seen.add(p.category);
			result.push(p.category);
		}
	}
	return result;
}
