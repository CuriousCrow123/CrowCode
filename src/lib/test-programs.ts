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

	// Category 13: New Features
	{
		id: 'p13.1', category: 'New Features', name: 'Switch / Case',
		source: `#include <stdio.h>

int main() {
    int day = 3;
    int type = 0;

    switch (day) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
            type = 1;  // weekday
            break;
        case 6:
        case 7:
            type = 2;  // weekend
            break;
        default:
            type = 0;  // invalid
    }
    // expect: type = 1
    return 0;
}`,
	},
	{
		id: 'p13.2', category: 'New Features', name: 'String Literal',
		source: `#include <stdio.h>
#include <stdlib.h>

int main() {
    char *greeting = "hello";
    char *name = "world";
    // greeting and name are heap-allocated char arrays
    // Each shows individual character values
    return 0;
}`,
	},
	{
		id: 'p13.3', category: 'New Features', name: 'Float Arithmetic',
		source: `#include <stdio.h>

int main() {
    float pi = 3.14159;
    float r = 5.0;
    float area = pi * r * r;
    // expect: area ≈ 78.53975

    int truncated = (int)area;
    // expect: truncated = 78

    float half = 1.0 / 2.0;
    // expect: half = 0.5

    return 0;
}`,
	},
	{
		id: 'p13.4', category: 'New Features', name: 'Uninitialized Variable',
		source: `#include <stdio.h>

int main() {
    int x;          // shows (uninit)
    int y = 10;     // shows 10

    x = y + 5;      // now x = 15
    int z = x * 2;  // z = 30

    return 0;
}`,
	},
	{
		id: 'p13.5', category: 'New Features', name: 'Chained Assignment',
		source: `#include <stdio.h>

int main() {
    int a = 0;
    int b = 0;
    int c = 0;

    a = b = c = 42;
    // expect: a = 42, b = 42, c = 42

    a = b = c + 8;
    // expect: a = 50, b = 50, c = 42

    return 0;
}`,
	},
	{
		id: 'p13.6', category: 'New Features', name: 'Function Pointer',
		source: `#include <stdio.h>

int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }

int main() {
    int (*fp)(int, int) = add;
    int a = fp(10, 3);   // expect: 13

    fp = sub;
    int b = fp(10, 3);   // expect: 7

    return 0;
}`,
	},
	{
		id: 'p13.7', category: 'New Features', name: '2D Array',
		source: `#include <stdio.h>

int main() {
    int m[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};

    // Identity matrix — set diagonal
    int trace = 0;
    for (int i = 0; i < 3; i++) {
        trace += m[i][i];
    }
    // expect: trace = 3

    m[1][2] = 5;
    m[2][0] = 7;
    return 0;
}`,
	},
	{
		id: 'p13.8', category: 'New Features', name: 'Array-to-Pointer Decay',
		source: `#include <stdio.h>

int main() {
    int arr[4] = {10, 20, 30, 40};
    int *p = arr;       // decay: p points to arr[0]

    int first = *p;     // 10
    int third = *(p + 2); // 30

    return 0;
}`,
	},

	// Category 14: Runtime Safety + Stdlib
	{
		id: 'p14.1', category: 'Runtime Safety', name: 'Use-After-Free',
		source: `#include <stdlib.h>

int main() {
    int *p = malloc(sizeof(int));
    *p = 42;
    free(p);
    int x = *p;  // Use-after-free error!
    return 0;
}`,
	},
	{
		id: 'p14.2', category: 'Runtime Safety', name: 'String Functions',
		source: `#include <string.h>
#include <stdlib.h>

int main() {
    char *s = "hello";
    int len = strlen(s);

    char *a = "abc";
    char *b = "abd";
    int cmp = strcmp(a, b);

    char *dst = malloc(8);
    strcpy(dst, s);
    int len2 = strlen(dst);

    free(dst);
    return 0;
}`,
	},
	{
		id: 'p14.3', category: 'Runtime Safety', name: 'Math Functions',
		source: `#include <math.h>
#include <stdlib.h>

int main() {
    int a = abs(-7);
    float s = sqrt(25.0);
    float p = pow(2.0, 10.0);
    return 0;
}`,
	},

	// Category: Big Integration
	{
		id: 'p15.1', category: 'Integration', name: 'Entity System',
		source: `#include <stdio.h>
#include <stdlib.h>

struct Vec2 {
    int x;
    int y;
};

struct Entity {
    int id;
    struct Vec2 pos;
    int *scores;
    int numScores;
};

int dot(struct Vec2 a, struct Vec2 b) {
    return a.x * b.x + a.y * b.y;
}

int sumScores(int *arr, int n) {
    int total = 0;
    for (int i = 0; i < n; i++) {
        total += arr[i];
    }
    return total;
}

int main() {
    // Allocate player on heap with nested struct
    struct Entity *player = malloc(sizeof(struct Entity));
    player->id = 1;
    player->pos.x = 3;
    player->pos.y = 4;

    // Allocate scores array through struct field
    player->scores = calloc(4, sizeof(int));
    player->numScores = 4;

    // Fill scores via loop
    for (int i = 0; i < 4; i++) {
        player->scores[i] = (i + 1) * 10;
    }

    // Stack struct + function call with pass-by-value
    struct Vec2 dir = {1, 0};
    int d = dot(player->pos, dir);

    // Function call with pointer parameter
    int total = sumScores(player->scores, player->numScores);

    // Branch on computed value
    if (total > 50) {
        player->pos.x += d;
    } else {
        player->pos.y += d;
    }

    // Clean up both allocations
    free(player->scores);
    free(player);
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
