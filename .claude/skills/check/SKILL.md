# /check

Run the full verification suite and report results. Use this before declaring any task done.

## Steps

Run these in order — stop and report on the first failure:

```bash
npx tsc --noEmit
```
Then:
```bash
npm test -- --run
```

## Report format

If everything passes:
> ✓ Type check passed. ✓ Tests passed (N tests). Ready to commit.

If type check fails:
> ✗ Type errors found: [list errors with file:line]. Fix these before proceeding.

If tests fail:
> ✗ N test(s) failed: [test names and error messages].

## Notes
- `--run` exits after one pass (no watch mode)
- Fix type errors before running tests — type errors can cause misleading test failures
- If a test is failing due to a missing env var, note that and skip rather than marking as broken
