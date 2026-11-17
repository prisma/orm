import { describe, expect, it } from 'vitest';
import { contract } from '../prisma/contract';

describe('demo TS contract authoring', () => {
  it('keeps Post.userId storage aligned with User.id', () => {
    const tables = contract.storage.namespaces['public'].entries.table;
    const userIdColumn = tables.post.columns.userId;
    const userIdTargetColumn = tables.user.columns.id;

    expect(userIdColumn.codecId).toBe(userIdTargetColumn.codecId);
    expect(userIdColumn.dataType).toBe(userIdTargetColumn.dataType);
    expect({ ...userIdColumn }).toEqual({ ...userIdTargetColumn });
  });
});
