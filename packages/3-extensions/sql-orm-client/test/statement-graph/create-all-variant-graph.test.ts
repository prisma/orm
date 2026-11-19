import { describe, expect, it } from 'vitest';
import { createCollectionTables } from '../../src/collection-tables';
import { createVariantGraph } from '../../src/statement-graph/collection-graphs';
import { mtiCreateContextOf } from '../../src/statement-graph/storage-rows';
import { emptyState } from '../../src/types';
import { buildMixedPolyContract, buildTestContextFromContract } from '../helpers';
import { printGraph } from './print-graph';
import { returnedAt } from './statements';

const contract = buildMixedPolyContract();
const tables = createCollectionTables(contract, 'public', 'Task');
const collection = {
  context: buildTestContextFromContract(contract),
  state: { ...emptyState(tables), variantValue: 'feature' },
  modelName: 'Task',
  namespaceId: 'public',
};
const mti = mtiCreateContextOf(collection);
if (mti === undefined) {
  throw new Error('the collection is narrowed to the MTI variant feature');
}
const row = (scalarData: Record<string, unknown>) => ({ scalarData, relationMutations: [] });
const darkMode = row({ title: 'Dark mode', priority: 1 });
const exportPdf = row({ title: 'Export to PDF', priority: 3 });

describe('createVariantGraph', () => {
  it('builds no node for no rows', () => {
    expect(printGraph(createVariantGraph(collection, mti, [], 'createAll'))).toBe('result: none');
  });

  it('inserts the base row, then the variant row with its key, and joins them for one row', () => {
    const graph = createVariantGraph(collection, mti, [darkMode], 'create');

    expect(printGraph(graph)).toBe(
      [
        'n1 Insert tasks',
        'n2 Insert features <- PayloadData n1 (id->id)',
        'n3 CrossJoin <- Rows n1, Rows n2',
        'result: n3',
      ].join('\n'),
    );
    expect(returnedAt(graph, 1)).toEqual(['features__priority', 'features__assignee_id']);
  });

  it('puts the joined rows of several rows one after another, each insert after the one before', () => {
    const graph = createVariantGraph(collection, mti, [darkMode, exportPdf], 'createAll');

    expect(printGraph(graph, { state: true })).toBe(
      [
        'n1 State tasks',
        'n2 Insert tasks <- state n1',
        'n3 State tasks <- state n2',
        'n4 State features',
        'n5 Insert features <- PayloadData n2 (id->id), state n4',
        'n6 State features <- state n5',
        'n7 Insert tasks <- state n3',
        'n8 State tasks <- state n7',
        'n9 Insert features <- PayloadData n7 (id->id), state n6',
        'n10 State features <- state n9',
        'n11 CrossJoin <- Rows n2, Rows n5',
        'n12 CrossJoin <- Rows n7, Rows n9',
        'n13 UnionAll <- Rows n11, Rows n12',
        'result: n13',
      ].join('\n'),
    );
  });

  describe('with selected fields', () => {
    const selecting = {
      ...collection,
      state: { ...collection.state, selectedFields: ['id', 'title'] },
    };

    it('reads the row back by its key after both inserts, with the selected fields', () => {
      const graph = createVariantGraph(selecting, mti, [darkMode], 'create');

      expect(printGraph(graph, { state: true })).toBe(
        [
          'n1 State tasks',
          'n2 Insert tasks <- state n1',
          'n3 State tasks <- state n2',
          'n4 State features',
          'n5 Insert features <- PayloadData n2 (id->id), state n4',
          'n6 State features <- state n5',
          'n7 FindByKeys tasks by (id) for create <- Rows n2, state n3, state n6',
          'result: n7',
        ].join('\n'),
      );
      expect(returnedAt(graph, 2)).toEqual(['id', 'title']);
    });

    it('reads the rows of several rows back in one statement by their keys', () => {
      const graph = createVariantGraph(selecting, mti, [darkMode, exportPdf], 'createAll');

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert tasks',
          'n2 Insert features <- PayloadData n1 (id->id)',
          'n3 Insert tasks',
          'n4 Insert features <- PayloadData n3 (id->id)',
          'n5 UnionAll <- Rows n1, Rows n3',
          'n6 FindByKeys tasks by (id) for createAll <- Rows n5',
          'result: n6',
        ].join('\n'),
      );
    });
  });
});
