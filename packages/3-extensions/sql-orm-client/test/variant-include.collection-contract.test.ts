import { describe, expect, it } from 'vitest';
import { resolveIncludeRelation } from '../src/collection-contract';
import { buildMixedPolyContract } from './helpers';

describe('resolveIncludeRelation() with a selected parent variant', () => {
  it('resolves an MTI-owned relation from the variant table', () => {
    const relation = resolveIncludeRelation(
      buildMixedPolyContract(),
      'public',
      'Task',
      'assignee',
      'Feature',
    );

    expect(relation).toEqual({
      relatedModelName: 'Assignee',
      relatedNamespaceId: 'public',
      relatedTableName: 'assignees',
      localTableName: 'features',
      localColumns: ['assignee_id'],
      targetColumns: ['id'],
      cardinality: 'N:1',
    });
  });

  it('resolves an STI-owned relation from the current parent table', () => {
    const relation = resolveIncludeRelation(
      buildMixedPolyContract(),
      'public',
      'Task',
      'assignee',
      'Bug',
    );

    expect(relation).toEqual({
      relatedModelName: 'Assignee',
      relatedNamespaceId: 'public',
      relatedTableName: 'assignees',
      localTableName: 'tasks',
      localColumns: ['assignee_id'],
      targetColumns: ['id'],
      cardinality: 'N:1',
    });
  });

  it('falls back to unshadowed base relation metadata after narrowing', () => {
    const relation = resolveIncludeRelation(
      buildMixedPolyContract(),
      'public',
      'Task',
      'subtasks',
      'Feature',
    );

    expect(relation).toEqual({
      relatedModelName: 'Task',
      relatedNamespaceId: 'public',
      relatedTableName: 'tasks',
      localTableName: 'tasks',
      localColumns: ['id'],
      targetColumns: ['parent_id'],
      cardinality: '1:N',
    });
  });
});
