import { describe, expect, it } from 'vitest';
import { SchemaTreeNode } from '../src/control/control-schema-view';

describe('SchemaTreeNode', () => {
  it('derives the plain label from its label parts', () => {
    const node = new SchemaTreeNode({
      kind: 'entity',
      id: 'table-user',
      labelParts: [
        { text: 'table', role: 'keyword' },
        { text: ' ' },
        { text: 'user', role: 'name' },
      ],
    });

    expect(node).toMatchObject({
      label: 'table user',
      labelParts: [
        { text: 'table', role: 'keyword' },
        { text: ' ' },
        { text: 'user', role: 'name' },
      ],
    });
  });
});
