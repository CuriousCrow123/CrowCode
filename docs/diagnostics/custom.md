# custom — Minimal Scalar

## Source (with line numbers)
```c
  1 | int main() {
  2 |     int x = 5;
  3 |     x = 10;
  4 |     x = x + 1;
  5 |     return 0;
  6 | }
```

## Instrumented Source
```c
#include "__crow.h"
int main() {
	__crow_push_scope("main", 1);
	__crow_step(1);
    int x = 5;
	__crow_decl("x", &x, sizeof(x), "int", 2);
	__crow_step(2);
    x = 10;
	__crow_set("x", &x, 3);
	__crow_step(3);
    x = x + 1;
	__crow_set("x", &x, 4);
	__crow_step(4);
    __crow_step(5);
	__crow_pop_scope();
	return 0;
}
```

## Steps (6 total)

### Step 0 | Line 1 | 2 ops
- addEntry(parent=null, id=main, name=main, type=, val=, kind=scope, addr=, children=0)
- addEntry(parent=null, id=heap, name=Heap, type=, val=, kind=heap, addr=, children=0)

### Step 1 | Line 2 | 1 ops
- addEntry(parent=main, id=main::x, name=x, type=int, val=5, kind=, addr=0x00001ff0, children=0)

### Step 2 | Line 3 | 1 ops
- setValue(id=main::x, val=10)

### Step 3 | Line 4 | 1 ops
- setValue(id=main::x, val=11)

### Step 4 | Line 5 | 0 ops

### Step 5 | Line 5 | 1 ops
- removeEntry(id=main)

## Snapshots (6 total)

### Snapshot 0 (after step 0)
- main | name=main | type= | val= | addr= | kind=scope | heap=
- heap | name=Heap | type= | val= | addr= | kind=heap | heap=

### Snapshot 1 (after step 1)
- main | name=main | type= | val= | addr= | kind=scope | heap=
  - main::x | name=x | type=int | val=5 | addr=0x00001ff0 | kind= | heap=
- heap | name=Heap | type= | val= | addr= | kind=heap | heap=

### Snapshot 2 (after step 2)
- main | name=main | type= | val= | addr= | kind=scope | heap=
  - main::x | name=x | type=int | val=10 | addr=0x00001ff0 | kind= | heap=
- heap | name=Heap | type= | val= | addr= | kind=heap | heap=

### Snapshot 3 (after step 3)
- main | name=main | type= | val= | addr= | kind=scope | heap=
  - main::x | name=x | type=int | val=11 | addr=0x00001ff0 | kind= | heap=
- heap | name=Heap | type= | val= | addr= | kind=heap | heap=

### Snapshot 4 (after step 4)
- main | name=main | type= | val= | addr= | kind=scope | heap=
  - main::x | name=x | type=int | val=11 | addr=0x00001ff0 | kind= | heap=
- heap | name=Heap | type= | val= | addr= | kind=heap | heap=

### Snapshot 5 (after step 5)
- heap | name=Heap | type= | val= | addr= | kind=heap | heap=
