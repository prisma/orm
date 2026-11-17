import { describe, expect, it } from 'vitest';
import { createCollectionFor } from '../collection-fixtures';
import { buildManyToManyContract } from '../helpers';

const sharedTenantContract = buildManyToManyContract({
  junctionTable: 'parent_child',
  parentColumns: ['tenant_id'],
  childColumns: ['tenant_id'],
  targetColumns: ['tenant_id'],
  localFields: ['tenant_id'],
});

describe('disconnect on a junction whose parent and target share a column', () => {
  it('disconnects nothing without an error when the parent and the target give the shared column different values', async () => {
    const { collection, runtime } = createCollectionFor('Parent' as never, sharedTenantContract);
    runtime.setNextResults([[{ tenant_id: 7 }], [{ tenant_id: 8 }]]);

    await expect(
      collection.where({ tenant_id: 7 } as never).update({
        children: (children: { disconnect: (criteria: Record<string, unknown>[]) => unknown }) =>
          children.disconnect([{ tenant_id: 8 }]),
      } as never),
    ).resolves.toEqual({ tenant_id: 7 });
  });
});
