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

int main() {
    int sum = 0;
    int arr[4] = {10, 20, 30, 40};

    for (int i = 0; i < 4; i++) {
        sum += arr[i];
    }

    int *squares = malloc(4 * sizeof(int));
    for (int j = 0; j < 4; j++) {
        squares[j] = arr[j] * arr[j];
    }

    int total = 0;
    for (int k = 0; k < 4; k++) {
        total += squares[k];
    }

    free(squares);
    return 0;
}`;

export const loops: Program = {
	name: 'For Loops',
	source,
	steps: [
		// Step 0: enter main, declare sum
		{
			location: { line: 5 },
			description: 'Enter main(), declare sum = 0',
			ops: [
				addScope(null, scope('main', 'main()', { caller: '_start', returnAddr: '0x00400580', file: 'loops.c', line: 3 })),
				addVar('main', variable('main-sum', 'sum', 'int', '0', '0x7ffc0060')),
				addScope(null, heapContainer()),
			],
		},
		// Step 1: declare and initialize arr
		{
			location: { line: 6 },
			description: 'int arr[4] = {10, 20, 30, 40}',
			ops: [
				addVar('main', variable('main-arr', 'arr', 'int[4]', '', '0x7ffc0064', [
					variable('arr-0', '[0]', 'int', '10', '0x7ffc0064'),
					variable('arr-1', '[1]', 'int', '20', '0x7ffc0068'),
					variable('arr-2', '[2]', 'int', '30', '0x7ffc006c'),
					variable('arr-3', '[3]', 'int', '40', '0x7ffc0070'),
				])),
			],
		},

		// === First for-loop: sum += arr[i] ===

		// Step 5: for init — int i = 0 (visible in line mode as "entering the loop")
		{
			location: { line: 8 },
			description: 'for: int i = 0',
			ops: [
				addScope('main', scope('for1', 'for', { file: 'loops.c', line: 8 })),
				addVar('for1', variable('for1-i', 'i', 'int', '0', '0x7ffc0074')),
			],
		},

		// --- Iteration 0 ---
		// Step 6: check i < 4 (true)
		{
			location: { line: 8, colStart: 20, colEnd: 25 },
			description: 'for: check i(0) < 4 → true',
			subStep: true,
			evaluation: '0 < 4 → true',
			ops: [],
		},
		// Step 7: sum += arr[0] → sum = 10
		{
			location: { line: 9 },
			description: 'sum += arr[0] → sum = 10',
			ops: [set('main-sum', '10')],
		},
		// Step 8: i++
		{
			location: { line: 8, colStart: 27, colEnd: 30 },
			description: 'for: i++ → i = 1',
			subStep: true,
			ops: [set('for1-i', '1')],
		},

		// --- Iteration 1 ---
		{
			location: { line: 8, colStart: 20, colEnd: 25 },
			description: 'for: check i(1) < 4 → true',
			subStep: true,
			evaluation: '1 < 4 → true',
			ops: [],
		},
		{
			location: { line: 9 },
			description: 'sum += arr[1] → sum = 30',
			ops: [set('main-sum', '30')],
		},
		{
			location: { line: 8, colStart: 27, colEnd: 30 },
			description: 'for: i++ → i = 2',
			subStep: true,
			ops: [set('for1-i', '2')],
		},

		// --- Iteration 2 ---
		{
			location: { line: 8, colStart: 20, colEnd: 25 },
			description: 'for: check i(2) < 4 → true',
			subStep: true,
			evaluation: '2 < 4 → true',
			ops: [],
		},
		{
			location: { line: 9 },
			description: 'sum += arr[2] → sum = 60',
			ops: [set('main-sum', '60')],
		},
		{
			location: { line: 8, colStart: 27, colEnd: 30 },
			description: 'for: i++ → i = 3',
			subStep: true,
			ops: [set('for1-i', '3')],
		},

		// --- Iteration 3 ---
		{
			location: { line: 8, colStart: 20, colEnd: 25 },
			description: 'for: check i(3) < 4 → true',
			subStep: true,
			evaluation: '3 < 4 → true',
			ops: [],
		},
		{
			location: { line: 9 },
			description: 'sum += arr[3] → sum = 100',
			ops: [set('main-sum', '100')],
		},
		{
			location: { line: 8, colStart: 27, colEnd: 30 },
			description: 'for: i++ → i = 4',
			subStep: true,
			ops: [set('for1-i', '4')],
		},

		// Step: final check fails (visible in line mode as "exiting the loop")
		{
			location: { line: 8 },
			description: 'for: i = 4, exit loop',
			evaluation: '4 < 4 → false',
			ops: [remove('for1')],
		},

		// === Second for-loop: squares on heap ===

		// Step: malloc squares
		{
			location: { line: 12 },
			description: 'malloc(16) — allocate squares array on heap',
			ops: [
				alloc('heap', heapBlock('heap-sq', 'int[4]', '0x55a0001000',
					{ size: 16, status: 'allocated', allocator: 'malloc', allocSite: { file: 'loops.c', line: 11 } },
					[
						variable('sq-0', '[0]', 'int', '0', '0x55a0001000'),
						variable('sq-1', '[1]', 'int', '0', '0x55a0001004'),
						variable('sq-2', '[2]', 'int', '0', '0x55a0001008'),
						variable('sq-3', '[3]', 'int', '0', '0x55a000100c'),
					],
				)),
				addVar('main', variable('main-squares', 'squares', 'int*', '0x55a0001000', '0x7ffc0078')),
			],
		},

		// Step: for init j = 0
		{
			location: { line: 13 },
			description: 'for: int j = 0',
			ops: [
				addScope('main', scope('for2', 'for', { file: 'loops.c', line: 13 })),
				addVar('for2', variable('for2-j', 'j', 'int', '0', '0x7ffc007c')),
			],
		},

		// --- j=0 ---
		{
			location: { line: 13, colStart: 20, colEnd: 25 },
			description: 'for: check j(0) < 4 → true',
			subStep: true,
			ops: [],
		},
		{
			location: { line: 14 },
			description: 'squares[0] = 10 * 10 = 100',
			ops: [set('sq-0', '100')],
		},
		{
			location: { line: 13, colStart: 27, colEnd: 30 },
			description: 'for: j++ → j = 1',
			subStep: true,
			ops: [set('for2-j', '1')],
		},

		// --- j=1 ---
		{
			location: { line: 13, colStart: 20, colEnd: 25 },
			description: 'for: check j(1) < 4 → true',
			subStep: true,
			ops: [],
		},
		{
			location: { line: 14 },
			description: 'squares[1] = 20 * 20 = 400',
			ops: [set('sq-1', '400')],
		},
		{
			location: { line: 13, colStart: 27, colEnd: 30 },
			description: 'for: j++ → j = 2',
			subStep: true,
			ops: [set('for2-j', '2')],
		},

		// --- j=2 ---
		{
			location: { line: 13, colStart: 20, colEnd: 25 },
			description: 'for: check j(2) < 4 → true',
			subStep: true,
			ops: [],
		},
		{
			location: { line: 14 },
			description: 'squares[2] = 30 * 30 = 900',
			ops: [set('sq-2', '900')],
		},
		{
			location: { line: 13, colStart: 27, colEnd: 30 },
			description: 'for: j++ → j = 3',
			subStep: true,
			ops: [set('for2-j', '3')],
		},

		// --- j=3 ---
		{
			location: { line: 13, colStart: 20, colEnd: 25 },
			description: 'for: check j(3) < 4 → true',
			subStep: true,
			ops: [],
		},
		{
			location: { line: 14 },
			description: 'squares[3] = 40 * 40 = 1600',
			ops: [set('sq-3', '1600')],
		},
		{
			location: { line: 13, colStart: 27, colEnd: 30 },
			description: 'for: j++ → j = 4',
			subStep: true,
			ops: [set('for2-j', '4')],
		},

		// exit loop 2
		{
			location: { line: 13 },
			description: 'for: j = 4, exit loop',
			evaluation: '4 < 4 → false',
			ops: [remove('for2')],
		},

		// === Third for-loop: total += squares[k] ===

		{
			location: { line: 17 },
			description: 'Declare total = 0',
			ops: [addVar('main', variable('main-total', 'total', 'int', '0', '0x7ffc0080'))],
		},

		// Step: for init k = 0
		{
			location: { line: 18 },
			description: 'for: int k = 0',
			ops: [
				addScope('main', scope('for3', 'for', { file: 'loops.c', line: 18 })),
				addVar('for3', variable('for3-k', 'k', 'int', '0', '0x7ffc0084')),
			],
		},

		// --- k=0 ---
		{
			location: { line: 18, colStart: 20, colEnd: 25 },
			description: 'for: check k(0) < 4 → true',
			subStep: true,
			ops: [],
		},
		{
			location: { line: 19 },
			description: 'total += squares[0] → total = 100',
			ops: [set('main-total', '100')],
		},
		{
			location: { line: 18, colStart: 27, colEnd: 30 },
			description: 'for: k++ → k = 1',
			subStep: true,
			ops: [set('for3-k', '1')],
		},

		// --- k=1 ---
		{
			location: { line: 18, colStart: 20, colEnd: 25 },
			description: 'for: check k(1) < 4 → true',
			subStep: true,
			ops: [],
		},
		{
			location: { line: 19 },
			description: 'total += squares[1] → total = 500',
			ops: [set('main-total', '500')],
		},
		{
			location: { line: 18, colStart: 27, colEnd: 30 },
			description: 'for: k++ → k = 2',
			subStep: true,
			ops: [set('for3-k', '2')],
		},

		// --- k=2 ---
		{
			location: { line: 18, colStart: 20, colEnd: 25 },
			description: 'for: check k(2) < 4 → true',
			subStep: true,
			ops: [],
		},
		{
			location: { line: 19 },
			description: 'total += squares[2] → total = 1400',
			ops: [set('main-total', '1400')],
		},
		{
			location: { line: 18, colStart: 27, colEnd: 30 },
			description: 'for: k++ → k = 3',
			subStep: true,
			ops: [set('for3-k', '3')],
		},

		// --- k=3 ---
		{
			location: { line: 18, colStart: 20, colEnd: 25 },
			description: 'for: check k(3) < 4 → true',
			subStep: true,
			ops: [],
		},
		{
			location: { line: 19 },
			description: 'total += squares[3] → total = 3000',
			ops: [set('main-total', '3000')],
		},
		{
			location: { line: 18, colStart: 27, colEnd: 30 },
			description: 'for: k++ → k = 4',
			subStep: true,
			ops: [set('for3-k', '4')],
		},

		// exit loop 3
		{
			location: { line: 18 },
			description: 'for: k = 4, exit loop',
			evaluation: '4 < 4 → false',
			ops: [remove('for3')],
		},

		// free squares
		{
			location: { line: 22 },
			description: 'free(squares) — deallocate heap array',
			ops: [
				free('heap-sq'),
				set('main-squares', '(dangling)'),
			],
		},

		// return
		{
			location: { line: 23 },
			description: 'return 0 — program ends',
			ops: [],
		},
	],
};
