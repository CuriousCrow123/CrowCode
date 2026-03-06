/**
 * Program definitions for the MemoryTracer widget.
 * Each program is a sequence of pre-computed step snapshots.
 */

export interface MemoryEntry {
  type: string;
  name: string;
  value: string;
  address: string;
  scope?: string;
  region?: 'stack' | 'heap';
  isNew?: boolean;
  isChanged?: boolean;
}

export interface OutputLine {
  text: string;
  isNew?: boolean;
}

export interface ProgramStep {
  lineNumber: number;
  description: string;
  memory: MemoryEntry[];
  output: OutputLine[];
}

export interface Program {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  code: string[];
  steps: ProgramStep[];
}

/* ── Address constants ────────────────────────────── */

const S = 0xBFFFF000; // stack base (descending)
const H = 0x0804B000; // heap base (ascending)

function hex(addr: number): string {
  return '0x' + addr.toString(16).toUpperCase().padStart(8, '0');
}

/* ── Program 1: Variables & Types ─────────────────── */

const variablesCode = [
  'int a = 10;',
  'double b = 3.14;',
  "char c = 'X';",
  'printf("a: value=%d, addr=%p, sizeof=%lu\\n", a, &a, sizeof(a));',
  'printf("b: value=%.2f, addr=%p, sizeof=%lu\\n", b, &b, sizeof(b));',
  'printf("c: value=%c, addr=%p, sizeof=%lu\\n", c, &c, sizeof(c));',
];

const variablesSteps: ProgramStep[] = [
  {
    lineNumber: 0,
    description: 'Program starts — no variables yet',
    memory: [],
    output: [],
  },
  {
    lineNumber: 1,
    description: 'Declare int a and assign 10 — 4 bytes on the stack',
    memory: [
      { type: 'int', name: 'a', value: '10', address: hex(S), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 2,
    description: 'Declare double b and assign 3.14 — 8 bytes on the stack',
    memory: [
      { type: 'int', name: 'a', value: '10', address: hex(S) },
      { type: 'double', name: 'b', value: '3.14', address: hex(S - 8), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 3,
    description: "Declare char c and assign 'X' — 1 byte on the stack",
    memory: [
      { type: 'int', name: 'a', value: '10', address: hex(S) },
      { type: 'double', name: 'b', value: '3.14', address: hex(S - 8) },
      { type: 'char', name: 'c', value: "'X'", address: hex(S - 16), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 4,
    description: 'Print a: its value, address, and sizeof',
    memory: [
      { type: 'int', name: 'a', value: '10', address: hex(S) },
      { type: 'double', name: 'b', value: '3.14', address: hex(S - 8) },
      { type: 'char', name: 'c', value: "'X'", address: hex(S - 16) },
    ],
    output: [
      { text: `a: value=10, addr=${hex(S)}, sizeof=4`, isNew: true },
    ],
  },
  {
    lineNumber: 5,
    description: 'Print b: double takes 8 bytes',
    memory: [
      { type: 'int', name: 'a', value: '10', address: hex(S) },
      { type: 'double', name: 'b', value: '3.14', address: hex(S - 8) },
      { type: 'char', name: 'c', value: "'X'", address: hex(S - 16) },
    ],
    output: [
      { text: `a: value=10, addr=${hex(S)}, sizeof=4` },
      { text: `b: value=3.14, addr=${hex(S - 8)}, sizeof=8`, isNew: true },
    ],
  },
  {
    lineNumber: 6,
    description: 'Print c: char takes just 1 byte',
    memory: [
      { type: 'int', name: 'a', value: '10', address: hex(S) },
      { type: 'double', name: 'b', value: '3.14', address: hex(S - 8) },
      { type: 'char', name: 'c', value: "'X'", address: hex(S - 16) },
    ],
    output: [
      { text: `a: value=10, addr=${hex(S)}, sizeof=4` },
      { text: `b: value=3.14, addr=${hex(S - 8)}, sizeof=8` },
      { text: `c: value=X, addr=${hex(S - 16)}, sizeof=1`, isNew: true },
    ],
  },
];

/* ── Program 2: Pointers ─────────────────────────── */

const pointersCode = [
  'int x = 42;',
  'double y = 3.14;',
  "char z = 'A';",
  'int *px = &x;',
  'double *py = &y;',
  'char *pz = &z;',
  'printf("px: value=%p, sizeof=%lu\\n", px, sizeof(px));',
  'printf("py: value=%p, sizeof=%lu\\n", py, sizeof(py));',
  'printf("pz: value=%p, sizeof=%lu\\n", pz, sizeof(pz));',
];

const pX = S;
const pY = S - 8;
const pZ = S - 16;
const pPX = S - 24;
const pPY = S - 32;
const pPZ = S - 40;

const pointersSteps: ProgramStep[] = [
  {
    lineNumber: 0,
    description: 'Program starts',
    memory: [],
    output: [],
  },
  {
    lineNumber: 1,
    description: 'Declare int x = 42',
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 2,
    description: 'Declare double y = 3.14',
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX) },
      { type: 'double', name: 'y', value: '3.14', address: hex(pY), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 3,
    description: "Declare char z = 'A'",
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX) },
      { type: 'double', name: 'y', value: '3.14', address: hex(pY) },
      { type: 'char', name: 'z', value: "'A'", address: hex(pZ), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 4,
    description: 'Pointer px stores the address of x — px is 8 bytes (64-bit pointer)',
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX) },
      { type: 'double', name: 'y', value: '3.14', address: hex(pY) },
      { type: 'char', name: 'z', value: "'A'", address: hex(pZ) },
      { type: 'int*', name: 'px', value: hex(pX), address: hex(pPX), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 5,
    description: 'Pointer py stores the address of y — also 8 bytes',
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX) },
      { type: 'double', name: 'y', value: '3.14', address: hex(pY) },
      { type: 'char', name: 'z', value: "'A'", address: hex(pZ) },
      { type: 'int*', name: 'px', value: hex(pX), address: hex(pPX) },
      { type: 'double*', name: 'py', value: hex(pY), address: hex(pPY), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 6,
    description: 'Pointer pz stores the address of z — still 8 bytes. All pointers are the same size!',
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX) },
      { type: 'double', name: 'y', value: '3.14', address: hex(pY) },
      { type: 'char', name: 'z', value: "'A'", address: hex(pZ) },
      { type: 'int*', name: 'px', value: hex(pX), address: hex(pPX) },
      { type: 'double*', name: 'py', value: hex(pY), address: hex(pPY) },
      { type: 'char*', name: 'pz', value: hex(pZ), address: hex(pPZ), isNew: true },
    ],
    output: [],
  },
  {
    lineNumber: 7,
    description: 'Print px: the stored address and sizeof(px) = 8',
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX) },
      { type: 'double', name: 'y', value: '3.14', address: hex(pY) },
      { type: 'char', name: 'z', value: "'A'", address: hex(pZ) },
      { type: 'int*', name: 'px', value: hex(pX), address: hex(pPX) },
      { type: 'double*', name: 'py', value: hex(pY), address: hex(pPY) },
      { type: 'char*', name: 'pz', value: hex(pZ), address: hex(pPZ) },
    ],
    output: [
      { text: `px: value=${hex(pX)}, sizeof=8`, isNew: true },
    ],
  },
  {
    lineNumber: 8,
    description: 'Print py: sizeof(py) = 8 — same as px!',
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX) },
      { type: 'double', name: 'y', value: '3.14', address: hex(pY) },
      { type: 'char', name: 'z', value: "'A'", address: hex(pZ) },
      { type: 'int*', name: 'px', value: hex(pX), address: hex(pPX) },
      { type: 'double*', name: 'py', value: hex(pY), address: hex(pPY) },
      { type: 'char*', name: 'pz', value: hex(pZ), address: hex(pPZ) },
    ],
    output: [
      { text: `px: value=${hex(pX)}, sizeof=8` },
      { text: `py: value=${hex(pY)}, sizeof=8`, isNew: true },
    ],
  },
  {
    lineNumber: 9,
    description: 'Print pz: sizeof(pz) = 8 — all pointers are 8 bytes on a 64-bit system',
    memory: [
      { type: 'int', name: 'x', value: '42', address: hex(pX) },
      { type: 'double', name: 'y', value: '3.14', address: hex(pY) },
      { type: 'char', name: 'z', value: "'A'", address: hex(pZ) },
      { type: 'int*', name: 'px', value: hex(pX), address: hex(pPX) },
      { type: 'double*', name: 'py', value: hex(pY), address: hex(pPY) },
      { type: 'char*', name: 'pz', value: hex(pZ), address: hex(pPZ) },
    ],
    output: [
      { text: `px: value=${hex(pX)}, sizeof=8` },
      { text: `py: value=${hex(pY)}, sizeof=8` },
      { text: `pz: value=${hex(pZ)}, sizeof=8`, isNew: true },
    ],
  },
];

/* ── Program 3: Arrays & sizeof ───────────────────── */

const arraysCode = [
  'int arr[5] = {10, 20, 30, 40, 50};',
  'int array_size = sizeof(arr) / sizeof(int);',
  'printf("Array: %lu bytes\\n", sizeof(arr));',
  'printf("Elements: %d\\n", array_size);',
  'printArray(arr, array_size);',
  '',
  '// Inside printArray(const int *arr, int size):',
  'printf("sizeof pointer: %lu\\n", sizeof(arr));',
  'printf("arr[0] = %d\\n", arr[0]);',
  'printf("arr[1] = %d\\n", arr[1]);',
  'printf("arr[2] = %d\\n", arr[2]);',
  'printf("arr[3] = %d\\n", arr[3]);',
  'printf("arr[4] = %d\\n", arr[4]);',
];

const aBase = S;
const arrEntries = [10, 20, 30, 40, 50];

function makeArrMemory(opts?: { scope?: boolean; isNew?: boolean }): MemoryEntry[] {
  const entries: MemoryEntry[] = arrEntries.map((v, i) => ({
    type: i === 0 ? 'int[5]' : '',
    name: i === 0 ? 'arr' : `arr[${i}]`,
    value: String(v),
    address: hex(aBase - i * 4),
  }));
  return entries;
}

const arrMainMem = makeArrMemory();
const arrMainMemWithSize: MemoryEntry[] = [
  ...arrMainMem,
  { type: 'int', name: 'array_size', value: '5', address: hex(aBase - 24), isNew: true },
];
const arrMainMemFull: MemoryEntry[] = [
  ...arrMainMem,
  { type: 'int', name: 'array_size', value: '5', address: hex(aBase - 24) },
];

// Function scope adds pointer and size params
function arrFuncMem(extra?: { highlight?: number }): MemoryEntry[] {
  const base: MemoryEntry[] = [
    ...arrMainMemFull,
    { type: 'const int*', name: 'arr', value: hex(aBase), address: hex(aBase - 32), scope: 'printArray', isNew: false },
    { type: 'int', name: 'size', value: '5', address: hex(aBase - 40), scope: 'printArray' },
  ];
  return base;
}

const arraysSteps: ProgramStep[] = [
  {
    lineNumber: 0,
    description: 'Program starts',
    memory: [],
    output: [],
  },
  {
    lineNumber: 1,
    description: 'Declare array of 5 ints — 20 bytes contiguous on the stack',
    memory: arrMainMem.map((e, i) => ({ ...e, isNew: i === 0 })),
    output: [],
  },
  {
    lineNumber: 2,
    description: 'sizeof(arr) = 20 bytes, sizeof(int) = 4 bytes → 20/4 = 5 elements',
    memory: arrMainMemWithSize,
    output: [],
  },
  {
    lineNumber: 3,
    description: 'Print total array size: 20 bytes (5 ints × 4 bytes each)',
    memory: arrMainMemFull,
    output: [
      { text: 'Array: 20 bytes', isNew: true },
    ],
  },
  {
    lineNumber: 4,
    description: 'Print element count: 5',
    memory: arrMainMemFull,
    output: [
      { text: 'Array: 20 bytes' },
      { text: 'Elements: 5', isNew: true },
    ],
  },
  {
    lineNumber: 5,
    description: 'Call printArray — the array decays to a pointer! New scope created.',
    memory: arrFuncMem(),
    output: [
      { text: 'Array: 20 bytes' },
      { text: 'Elements: 5' },
    ],
  },
  {
    lineNumber: 8,
    description: 'sizeof(arr) inside function = 8! The array decayed to a pointer.',
    memory: arrFuncMem(),
    output: [
      { text: 'Array: 20 bytes' },
      { text: 'Elements: 5' },
      { text: 'sizeof pointer: 8', isNew: true },
    ],
  },
  {
    lineNumber: 9,
    description: 'Print arr[0] using the pointer',
    memory: arrFuncMem(),
    output: [
      { text: 'Array: 20 bytes' },
      { text: 'Elements: 5' },
      { text: 'sizeof pointer: 8' },
      { text: 'arr[0] = 10', isNew: true },
    ],
  },
  {
    lineNumber: 10,
    description: 'Print arr[1]',
    memory: arrFuncMem(),
    output: [
      { text: 'Array: 20 bytes' },
      { text: 'Elements: 5' },
      { text: 'sizeof pointer: 8' },
      { text: 'arr[0] = 10' },
      { text: 'arr[1] = 20', isNew: true },
    ],
  },
  {
    lineNumber: 11,
    description: 'Print arr[2]',
    memory: arrFuncMem(),
    output: [
      { text: 'Array: 20 bytes' },
      { text: 'Elements: 5' },
      { text: 'sizeof pointer: 8' },
      { text: 'arr[0] = 10' },
      { text: 'arr[1] = 20' },
      { text: 'arr[2] = 30', isNew: true },
    ],
  },
  {
    lineNumber: 12,
    description: 'Print arr[3]',
    memory: arrFuncMem(),
    output: [
      { text: 'Array: 20 bytes' },
      { text: 'Elements: 5' },
      { text: 'sizeof pointer: 8' },
      { text: 'arr[0] = 10' },
      { text: 'arr[1] = 20' },
      { text: 'arr[2] = 30' },
      { text: 'arr[3] = 40', isNew: true },
    ],
  },
  {
    lineNumber: 13,
    description: 'Print arr[4] — function complete, scope will be cleaned up',
    memory: arrFuncMem(),
    output: [
      { text: 'Array: 20 bytes' },
      { text: 'Elements: 5' },
      { text: 'sizeof pointer: 8' },
      { text: 'arr[0] = 10' },
      { text: 'arr[1] = 20' },
      { text: 'arr[2] = 30' },
      { text: 'arr[3] = 40' },
      { text: 'arr[4] = 50', isNew: true },
    ],
  },
];

/* ── Program 4: Heap Averager ─────────────────────── */

const heapCode = [
  'int *count = (int*)malloc(sizeof(int));',
  'double *sum = (double*)malloc(sizeof(double));',
  'double *input = (double*)malloc(sizeof(double));',
  '*count = 0;',
  '*sum = 0.0;',
  '*input = 5.5;',
  '*sum += *input;',
  '(*count)++;',
  '*input = 3.2;',
  '*sum += *input;',
  '(*count)++;',
  '*input = 7.1;',
  '*sum += *input;',
  '(*count)++;',
  'double *avg = (double*)malloc(sizeof(double));',
  '*avg = *sum / *count;',
  'printf("Count: %d, Average: %.3f\\n", *count, *avg);',
];

function heapMem(stack: Array<{ name: string; type: string; target: string; addr: number }>,
                  heapBlocks: Array<{ name: string; type: string; value: string; addr: number; isNew?: boolean; isChanged?: boolean }>): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const s of stack) {
    entries.push({
      type: s.type,
      name: s.name,
      value: hex(heapBlocks.find(h => h.name === s.target)?.addr ?? 0),
      address: hex(s.addr),
      region: 'stack',
      isNew: s.addr === stack[stack.length - 1]?.addr && heapBlocks[heapBlocks.length - 1]?.isNew ? true : undefined,
    });
  }
  for (const h of heapBlocks) {
    entries.push({
      type: h.type,
      name: h.name,
      value: h.value,
      address: hex(h.addr),
      region: 'heap',
      isNew: h.isNew,
      isChanged: h.isChanged,
    });
  }
  return entries;
}

// Build heap steps procedurally
function buildHeapSteps(): ProgramStep[] {
  const steps: ProgramStep[] = [];
  const stackPtrs: Array<{ name: string; type: string; target: string; addr: number }> = [];
  const heapBlocks: Array<{ name: string; type: string; value: string; addr: number }> = [];
  let count = 0, sum = 0;
  let heapOffset = 0;
  const output: OutputLine[] = [];

  function snap(line: number, desc: string, newHeap?: string, changedHeap?: string): void {
    const mem: MemoryEntry[] = [];
    for (const s of stackPtrs) {
      const target = heapBlocks.find(h => h.name === s.target);
      mem.push({
        type: s.type, name: s.name,
        value: target ? hex(target.addr) : '?',
        address: hex(s.addr), region: 'stack',
        isNew: newHeap !== undefined && s.target === newHeap,
      });
    }
    for (const h of heapBlocks) {
      mem.push({
        type: h.type, name: h.name, value: h.value,
        address: hex(h.addr), region: 'heap',
        isNew: h.name === newHeap,
        isChanged: h.name === changedHeap,
      });
    }
    steps.push({ lineNumber: line, description: desc, memory: [...mem], output: output.map(o => ({ ...o })) });
  }

  // Step 0: empty
  steps.push({ lineNumber: 0, description: 'Program starts — all variables will be pointers, all data on the heap', memory: [], output: [] });

  // Step 1: malloc count
  stackPtrs.push({ name: 'count', type: 'int*', target: '*count', addr: S });
  heapBlocks.push({ name: '*count', type: 'int', value: '?', addr: H + heapOffset });
  heapOffset += 4;
  snap(1, 'malloc allocates 4 bytes on the heap for count', '*count');

  // Step 2: malloc sum
  stackPtrs.push({ name: 'sum', type: 'double*', target: '*sum', addr: S - 8 });
  heapBlocks.push({ name: '*sum', type: 'double', value: '?', addr: H + heapOffset });
  heapOffset += 8;
  snap(2, 'malloc allocates 8 bytes on the heap for sum', '*sum');

  // Step 3: malloc input
  stackPtrs.push({ name: 'input', type: 'double*', target: '*input', addr: S - 16 });
  heapBlocks.push({ name: '*input', type: 'double', value: '?', addr: H + heapOffset });
  heapOffset += 8;
  snap(3, 'malloc allocates 8 bytes on the heap for input', '*input');

  // Step 4: *count = 0
  heapBlocks[0].value = '0';
  snap(4, 'Initialize *count to 0 via the pointer', undefined, '*count');

  // Step 5: *sum = 0.0
  heapBlocks[1].value = '0.0';
  snap(5, 'Initialize *sum to 0.0 via the pointer', undefined, '*sum');

  // Loop iterations
  const inputs = [5.5, 3.2, 7.1];
  let lineNum = 6;
  for (const val of inputs) {
    // *input = val
    heapBlocks[2].value = String(val);
    snap(lineNum++, `Read input value ${val}`, undefined, '*input');

    // *sum += *input
    sum += val;
    heapBlocks[1].value = String(Math.round(sum * 10) / 10);
    snap(lineNum++, `*sum += *input → sum = ${Math.round(sum * 10) / 10}`, undefined, '*sum');

    // (*count)++
    count++;
    heapBlocks[0].value = String(count);
    snap(lineNum++, `(*count)++ → count = ${count}`, undefined, '*count');
  }

  // Step 15: malloc avg
  stackPtrs.push({ name: 'avg', type: 'double*', target: '*avg', addr: S - 24 });
  heapBlocks.push({ name: '*avg', type: 'double', value: '?', addr: H + heapOffset });
  heapOffset += 8;
  snap(lineNum++, 'malloc allocates 8 bytes on the heap for avg', '*avg');

  // Step 16: *avg = *sum / *count
  const average = sum / count;
  heapBlocks[3].value = (Math.round(average * 1000) / 1000).toString();
  snap(lineNum++, `*avg = *sum / *count = ${(Math.round(average * 1000) / 1000)}`, undefined, '*avg');

  // Step 17: printf
  output.push({ text: `Count: ${count}, Average: ${(Math.round(average * 1000) / 1000)}`, isNew: true });
  snap(lineNum, `Print the results`);

  return steps;
}

const heapSteps = buildHeapSteps();

/* ── Export all programs ──────────────────────────── */

export const programs: Program[] = [
  {
    id: 'variables',
    title: 'Variables & Types',
    shortTitle: 'Variables',
    description: 'Three data types, three different sizes in memory',
    code: variablesCode,
    steps: variablesSteps,
  },
  {
    id: 'pointers',
    title: 'Pointers',
    shortTitle: 'Pointers',
    description: 'Pointers store addresses — and they\'re all the same size',
    code: pointersCode,
    steps: pointersSteps,
  },
  {
    id: 'arrays',
    title: 'Arrays & sizeof',
    shortTitle: 'Arrays',
    description: 'Contiguous memory, sizeof tricks, and array decay in functions',
    code: arraysCode,
    steps: arraysSteps,
  },
  {
    id: 'heap',
    title: 'Heap Averager',
    shortTitle: 'Heap',
    description: 'All data on the heap — pointer-only stack variables',
    code: heapCode,
    steps: heapSteps,
  },
];
