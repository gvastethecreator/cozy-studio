import { describe, expect, it } from 'vitest';
import { CATALOG_RENDER_BUDGET } from './catalogRenderBudget';

describe('catalogRenderBudget', () => {
  it('lets the active catalog fetch a large page while staying under the backend cap', () => {
    expect(CATALOG_RENDER_BUDGET.activePageSize).toBeGreaterThanOrEqual(120);
    expect(CATALOG_RENDER_BUDGET.activePageSize).toBeLessThanOrEqual(200);
  });
});
