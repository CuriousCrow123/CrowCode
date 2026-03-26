import type { Program } from '$lib/types';
import {
	scope,
	heapContainer,
	variable,
	heapBlock,
	addScope,
	addVar,
	addChild,
	alloc,
	set,
	free,
	remove,
} from '$lib/engine';

const source = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
    int count = 3;
    struct Point origin = {0, 0};

    struct Player *p = malloc(sizeof(struct Player));
    p->id = 1;
    p->pos.x = 10;
    p->pos.y = 20;

    p->scores = calloc(count, sizeof(int));
    p->scores[0] = 100;
    p->scores[1] = 200;
    p->scores[2] = 300;

    int d = distance(origin, p->pos);

    {
        char *msg = malloc(64);
        sprintf(msg, "dist=%d", d);
        printf("%s\\n", msg);
        free(msg);
    }

    free(p->scores);
    free(p);

    return 0;
}`;

export const basics: Program = {
	name: 'Memory Basics',
	source,
	steps: [
		// Step 0: enter main, declare count
		{
			location: { line: 23 },
			description: 'Enter main(), declare count = 3',
			ops: [
				addScope(null, scope('main', 'main()', { caller: '_start', returnAddr: '0x00400580', file: 'basics.c', line: 22 })),
				addVar('main', variable('main-count', 'count', 'int', '3', '0x7ffc0060')),
				addScope(null, heapContainer()),
			],
		},
		// Step 1: declare and initialize origin
		{
			location: { line: 24 },
			description: 'struct Point origin = {0, 0}',
			ops: [
				addVar('main', variable('main-origin', 'origin', 'struct Point', '', '0x7ffc0064', [
					variable('main-origin-x', '.x', 'int', '0', '0x7ffc0064'),
					variable('main-origin-y', '.y', 'int', '0', '0x7ffc0068'),
				])),
			],
		},
		// Step 2: malloc for Player
		{
			location: { line: 26 },
			description: 'malloc(sizeof(struct Player)) — allocate 20 bytes',
			ops: [
				alloc('heap', heapBlock('heap-player', 'struct Player', '0x55a0001000',
					{ size: 20, status: 'allocated', allocator: 'malloc', allocSite: { file: 'basics.c', line: 26 } },
					[
						variable('heap-player-id', '.id', 'int', '0', '0x55a0001000'),
						variable('heap-player-pos', '.pos', 'struct Point', '', '0x55a0001004', [
							variable('heap-player-pos-x', '.x', 'int', '0', '0x55a0001004'),
							variable('heap-player-pos-y', '.y', 'int', '0', '0x55a0001008'),
						]),
						variable('heap-player-scores', '.scores', 'int*', 'NULL', '0x55a000100c'),
					],
				)),
				addVar('main', variable('main-p', 'p', 'struct Player*', '0x55a0001000', '0x7ffc006c')),
			],
		},
		// Step 3: p->id = 1
		{
			location: { line: 27 },
			description: 'p->id = 1',
			ops: [set('heap-player-id', '1')],
		},
		// Step 4: p->pos.x = 10
		{
			location: { line: 28 },
			description: 'p->pos.x = 10',
			ops: [set('heap-player-pos-x', '10')],
		},
		// Step 5: p->pos.y = 20
		{
			location: { line: 29 },
			description: 'p->pos.y = 20',
			ops: [set('heap-player-pos-y', '20')],
		},
		// Step 6: calloc scores
		{
			location: { line: 31 },
			description: 'calloc(3, sizeof(int)) — allocate 12 bytes for scores',
			ops: [
				alloc('heap', heapBlock('heap-scores', 'int[3]', '0x55a0002000',
					{ size: 12, status: 'allocated', allocator: 'calloc', allocSite: { file: 'basics.c', line: 31 } },
					[
						variable('heap-scores-0', '[0]', 'int', '0', '0x55a0002000'),
						variable('heap-scores-1', '[1]', 'int', '0', '0x55a0002004'),
						variable('heap-scores-2', '[2]', 'int', '0', '0x55a0002008'),
					],
				)),
				set('heap-player-scores', '0x55a0002000'),
			],
		},
		// Step 7: scores[0] = 100
		{
			location: { line: 32 },
			description: 'p->scores[0] = 100',
			ops: [set('heap-scores-0', '100')],
		},
		// Step 8: scores[1] = 200
		{
			location: { line: 33 },
			description: 'p->scores[1] = 200',
			ops: [set('heap-scores-1', '200')],
		},
		// Step 9: scores[2] = 300
		{
			location: { line: 34 },
			description: 'p->scores[2] = 300',
			ops: [set('heap-scores-2', '300')],
		},
		// Step 10: call distance — push scope
		{
			location: { line: 36 },
			description: 'Call distance(origin, p->pos) — push stack frame',
			ops: [
				addScope(null, scope('dist', 'distance(a, b)', { caller: 'main()', returnAddr: '0x00401045', file: 'basics.c', line: 16 })),
				addVar('dist', variable('dist-a', 'a', 'struct Point', '', '0x7ffc0040', [
					variable('dist-a-x', '.x', 'int', '0', '0x7ffc0040'),
					variable('dist-a-y', '.y', 'int', '0', '0x7ffc0044'),
				])),
				addVar('dist', variable('dist-b', 'b', 'struct Point', '', '0x7ffc0048', [
					variable('dist-b-x', '.x', 'int', '10', '0x7ffc0048'),
					variable('dist-b-y', '.y', 'int', '20', '0x7ffc004c'),
				])),
			],
		},
		// Step 11: dx = a.x - b.x
		{
			location: { line: 17 },
			description: 'int dx = 0 - 10 = -10',
			ops: [
				addVar('dist', variable('dist-dx', 'dx', 'int', '-10', '0x7ffc0050')),
			],
		},
		// Step 12: dy = a.y - b.y
		{
			location: { line: 18 },
			description: 'int dy = 0 - 20 = -20',
			ops: [
				addVar('dist', variable('dist-dy', 'dy', 'int', '-20', '0x7ffc0054')),
			],
		},
		// Step 13: return dx*dx + dy*dy
		{
			location: { line: 19 },
			description: 'return (-10)*(-10) + (-20)*(-20) = 500',
			evaluation: 'dx*dx + dy*dy → 500',
			ops: [],
		},
		// Step 14: pop distance, assign d
		{
			location: { line: 36 },
			description: 'distance() returns 500, assign to d',
			ops: [
				remove('dist'),
				addVar('main', variable('main-d', 'd', 'int', '500', '0x7ffc0070')),
			],
		},
		// Step 15: enter block scope
		{
			location: { line: 38 },
			description: 'Enter block scope',
			ops: [
				addScope('main', scope('main-block', '{ }', { file: 'basics.c', line: 38 })),
			],
		},
		// Step 16: malloc msg
		{
			location: { line: 39 },
			description: 'malloc(64) for msg',
			ops: [
				alloc('heap', heapBlock('heap-msg', 'char[64]', '0x55a0003000',
					{ size: 64, status: 'allocated', allocator: 'malloc', allocSite: { file: 'basics.c', line: 39 } },
				)),
				addVar('main-block', variable('block-msg', 'msg', 'char*', '0x55a0003000', '0x7ffc0074')),
			],
		},
		// Step 17: sprintf
		{
			location: { line: 40 },
			description: 'sprintf(msg, "dist=%d", d) — write "dist=500"',
			ops: [set('heap-msg', '"dist=500"')],
		},
		// Step 18: printf
		{
			location: { line: 41 },
			description: 'printf("%s\\n", msg) — output: dist=500',
			ops: [],
		},
		// Step 19: free(msg)
		{
			location: { line: 42 },
			description: 'free(msg) — deallocate msg buffer',
			ops: [free('heap-msg')],
		},
		// Step 20: exit block scope
		{
			location: { line: 43 },
			description: 'Exit block scope — msg pointer goes out of scope',
			ops: [
				remove('main-block'),
				remove('heap-msg'),
			],
		},
		// Step 21: free(p->scores)
		{
			location: { line: 45 },
			description: 'free(p->scores) — deallocate scores array',
			ops: [
				free('heap-scores'),
				set('heap-player-scores', '(dangling)'),
			],
		},
		// Step 22: free(p)
		{
			location: { line: 46 },
			description: 'free(p) — deallocate Player struct',
			ops: [
				free('heap-player'),
				set('main-p', '(dangling)'),
			],
		},
		// Step 23: return 0
		{
			location: { line: 48 },
			description: 'return 0 — program ends',
			ops: [],
		},
	],
};
