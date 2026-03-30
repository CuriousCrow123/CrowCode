# custom — Minimal Scalar — Audit

## Line-by-Line

| Source Line | C Statement | Expected Step? | Actual Step | Expected Ops | Actual Ops | Expected Values | Actual Values | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | `int main() {` | Step 0 | Step 0, Line 1 | addEntry(main, scope), addEntry(heap) | addEntry(main, scope), addEntry(heap) | — | — | OK |
| 2 | `int x = 5;` | Step 1 | Step 1, Line 2 | addEntry(main::x, int, val=5) | addEntry(parent=main, id=main::x, type=int, val=5) | x=5 | x=5 | OK |
| 3 | `x = 10;` | Step 2 | Step 2, Line 3 | setValue(main::x, 10) | setValue(id=main::x, val=10) | x=10 | x=10 | OK |
| 4 | `x = x + 1;` | Step 3 | Step 3, Line 4 | setValue(main::x, 11) | setValue(id=main::x, val=11) | x=11 | x=11 | OK |
| 5 | `return 0;` | Step 4 at Line 5 | Step 4, Line 4 | removeEntry(main) | removeEntry(id=main) | scope removed | scope removed | BUG: line mismatch |

### Snapshot Verification

| Snapshot | Expected State | Actual State | Status |
|---|---|---|---|
| 0 | main(scope), heap | main(scope), heap | OK |
| 1 | main::x=5 | main::x=5 | OK |
| 2 | main::x=10 | main::x=10 | OK |
| 3 | main::x=11 | main::x=11 | OK |
| 4 | heap only (main removed) | heap only | OK |

## Bugs Found

- [ ] BUG-custom-1: Step 4 (scope cleanup / return) reports Line 4 but `return 0;` is on source line 5. The cleanup step should be associated with the return statement's line.
