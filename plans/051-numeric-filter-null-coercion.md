# Plan 051: Prevent Coercion of Null and Undefined Values in Numeric Filters

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e89c1ec2..HEAD -- packages/core/src/rowModel.ts`
> If the in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e89c1ec2`, 2026-06-14

## Why this matters

The client-side row model compares values in filter columns. When performing a numeric filter comparison (e.g. `gt`, `gte`, `lt`, `lte`), any `null` value in the grid's cell is coerced to `0` by `Number(value)`. Consequently, rows with `null` price or count values incorrectly match filters like "price is less than 5" (`0 < 5`). This causes incorrect data rows to show up in filtered grids.

This plan fixes the issue by checking that the cell value is not `null` or `undefined` (and is a valid finite number) before running numeric comparisons.

## Current state

- File in scope:
    - `packages/core/src/rowModel.ts` — contains the `matchesPreparedFilter` helper function.

### Excerpt (`packages/core/src/rowModel.ts:150-173`)

```typescript
function matchesPreparedFilter<TData>(value: unknown, pf: PreparedFilter<TData>): boolean {
	const textValue = String(value ?? '').toLowerCase();
	const numericValue = Number(value);

	switch (pf.operator) {
		case 'equals':
			return textValue === pf.textFilter;
		case 'startsWith':
			return textValue.startsWith(pf.textFilter);
		case 'endsWith':
			return textValue.endsWith(pf.textFilter);
		case 'gt':
			return numericValue > pf.numericFilter;
		case 'gte':
			return numericValue >= pf.numericFilter;
		case 'lt':
			return numericValue < pf.numericFilter;
		case 'lte':
			return numericValue <= pf.numericFilter;
		case 'contains':
		default:
			return textValue.includes(pf.textFilter);
	}
}
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
| --------- | ------------------------ | ------------------- |
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no errors   |
| Tests     | `pnpm test`              | all pass            |

## Scope

**In scope**:

- `packages/core/src/rowModel.ts`
- `packages/core/src/rowModel.test.ts`

**Out of scope**:

- Any other row model stages, server-side row models, or React components.

## Steps

### Step 1: Update matchesPreparedFilter to safeguard numeric conversions

In `packages/core/src/rowModel.ts`, modify the `matchesPreparedFilter` function to check if `value == null` or if the value is not a valid number (e.g. `Number.isNaN(numericValue)`) before applying numeric comparison operators. If it is null/undefined/NaN, numeric operators should return `false`.

For example, update the helper to:

```typescript
function matchesPreparedFilter<TData>(value: unknown, pf: PreparedFilter<TData>): boolean {
	const textValue = String(value ?? '').toLowerCase();

	if (pf.operator === 'gt' || pf.operator === 'gte' || pf.operator === 'lt' || pf.operator === 'lte') {
		if (value == null || value === '') return false;
		const numericValue = Number(value);
		if (Number.isNaN(numericValue)) return false;

		switch (pf.operator) {
			case 'gt':
				return numericValue > pf.numericFilter;
			case 'gte':
				return numericValue >= pf.numericFilter;
			case 'lt':
				return numericValue < pf.numericFilter;
			case 'lte':
				return numericValue <= pf.numericFilter;
		}
	}

	switch (pf.operator) {
		case 'equals':
			return textValue === pf.textFilter;
		case 'startsWith':
			return textValue.startsWith(pf.textFilter);
		case 'endsWith':
			return textValue.endsWith(pf.textFilter);
		case 'contains':
		default:
			return textValue.includes(pf.textFilter);
	}
}
```

**Verify**: `pnpm exec tsc --noEmit` exits with status 0.

### Step 2: Add test cases to verify numeric null filtering

In `packages/core/src/rowModel.test.ts`, add test cases asserting that fields with `null`, `undefined`, and `""` do NOT match numeric comparisons like `gt 0`, `lt 10`, `gte 0`, or `lte 10`.

**Verify**: `pnpm test` runs and all tests (including the new ones) pass.

## Done criteria

- [ ] `packages/core/src/rowModel.ts` is updated to safeguard numeric conversions.
- [ ] New test cases exist in `packages/core/src/rowModel.test.ts` for filtering `null`/`undefined`/`""` values.
- [ ] `pnpm exec tsc --noEmit` typechecks without errors.
- [ ] `pnpm test` exits 0 with all tests passing.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- If the current implementation of `matchesPreparedFilter` does not match the excerpt.
- If new type errors are introduced that cannot be resolved in `rowModel.ts`.
