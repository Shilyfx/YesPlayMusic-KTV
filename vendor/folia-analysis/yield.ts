// Worker host adaptation of src/services/automix/uiYield.ts at the pinned revision.
// Preserve its measured 8 ms work budget and yield a worker task turn so cancellation can run.
export const YIELD_BUDGET_MS = 8;
export const yieldToUi = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
