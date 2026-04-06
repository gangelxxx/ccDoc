/** Block automatically appended to the end of every plan */
export const PLAN_VERIFICATION_BLOCK = `
---
## ✅ Mandatory result verification

After implementing ALL plan steps, perform at least **two verification iterations**. Do NOT report completion until both iterations have passed.

### Iteration 1
1. **Plan compliance:** go through each plan item and confirm it has been completed. Flag any skipped or incomplete steps.
2. **Error check:** check the result for errors — syntax, logic, types, missed edge-cases, incorrect file names/paths/signatures.
3. **Fix:** if discrepancies or errors are found — fix them.

### Iteration 2
1. **Plan compliance (re-check):** go through each item again — make sure fixes from iteration 1 did not break anything and all steps are still completed.
2. **Error check (re-check):** check for errors once more — including in code that was modified during fixes.
3. **Fix:** if new issues are found — fix them and re-verify.
`;

/** Instruction for the executor model's system prompt */
export const PLAN_EXECUTOR_INSTRUCTION = `
IMPORTANT: When working with a plan, strictly follow each step. Do not skip items, do not change the order, do not add extras without explicit instruction. Pay attention to details: file names, paths, types, function signatures. After completion — verify the result.
`;
