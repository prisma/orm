import {
  AggregateExpr,
  BinaryExpr,
  CodecJsonValueProjection,
  ColumnRef,
  JsonObjectExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createIncludeScalar } from '../src/include-descriptors';
import { compileSelectWithIncludes } from '../src/query-plan-select';
import { emptyState } from '../src/types';
import { buildMixedPolyContract, getTestAggregates } from './helpers';
import {
  assigneeInclude,
  assigneeRows,
  childRowsFor,
  featureJoin,
  includeExpr,
  projection,
  rootState,
  rowAggregate,
  selectedState,
} from './variant-include.query-plan-fixtures';

describe('variant-owned include parent correlation', () => {
  it('correlates an MTI relation from the joined variant table without base-key projection', () => {
    const contract = buildMixedPolyContract();
    const include = assigneeInclude('features');
    const childRows = assigneeRows('features', 'assignee_id');
    const aggregate = rowAggregate('assignee', childRows, ['id', 'name']);

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Task',
      'tasks',
      rootState(include, 'Feature', 'title'),
    );

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([
          projection('title', 'tasks', 'title', 'pg/text@1'),
          ProjectionItem.of('assignee', SubqueryExpr.of(aggregate)),
        ])
        .withJoins([featureJoin]),
    );
  });

  it('correlates an STI relation from the current parent table', () => {
    const contract = buildMixedPolyContract();
    const include = assigneeInclude('tasks');
    const childRows = assigneeRows('tasks', 'assignee_id');
    const aggregate = rowAggregate('assignee', childRows, ['id', 'name']);

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Task',
      'tasks',
      rootState(include, 'Bug', 'title'),
    );

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public')).withProjection([
        projection('title', 'tasks', 'title', 'pg/text@1'),
        ProjectionItem.of('assignee', SubqueryExpr.of(aggregate)),
      ]),
    );
  });

  it('keeps a narrowed base relation correlated from the base parent table', () => {
    const contract = buildMixedPolyContract();
    const include = includeExpr({
      relationName: 'subtasks',
      relatedModelName: 'Task',
      relatedTableName: 'tasks',
      localTableName: 'tasks',
      targetColumn: 'parent_id',
      localColumn: 'id',
      cardinality: '1:N',
      nested: selectedState('id'),
    });

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Task',
      'tasks',
      rootState(include, 'Feature', 'title'),
    );
    const childRows = childRowsFor(plan.ast, 'subtasks');

    expect(childRows.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('subtasks__child', 'parent_id'), ColumnRef.of('tasks', 'id')),
    );
  });
});

describe('variant-owned include child alias collisions', () => {
  it('aliases a row-valued child that shares the resolved MTI parent table', () => {
    const contract = buildMixedPolyContract();
    const include = includeExpr({
      relationName: 'relatedFeature',
      relatedModelName: 'Feature',
      relatedTableName: 'features',
      localTableName: 'features',
      targetColumn: 'id',
      localColumn: 'assignee_id',
      cardinality: '1:N',
      nested: selectedState('id'),
    });
    const childRows = SelectAst.from(
      TableSource.named('features', 'relatedFeature__child', 'public'),
    )
      .withProjection([projection('id', 'relatedFeature__child', 'id', 'pg/int4@1')])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('relatedFeature__child', 'id'),
          ColumnRef.of('features', 'assignee_id'),
        ),
      );
    const aggregate = rowAggregate('relatedFeature', childRows, ['id']);

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Task',
      'tasks',
      rootState(include, 'Feature', 'title'),
    );

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([
          projection('title', 'tasks', 'title', 'pg/text@1'),
          ProjectionItem.of('relatedFeature', SubqueryExpr.of(aggregate)),
        ])
        .withJoins([featureJoin]),
    );
  });

  it('aliases a scalar child that shares the resolved MTI parent table', () => {
    const contract = buildMixedPolyContract();
    const scalar = createIncludeScalar<number>('count', emptyState());
    const include = includeExpr({
      relationName: 'featureCount',
      relatedModelName: 'Feature',
      relatedTableName: 'features',
      localTableName: 'features',
      targetColumn: 'id',
      localColumn: 'assignee_id',
      cardinality: '1:N',
      scalar,
    });
    const scalarSelect = SelectAst.from(
      TableSource.named('features', 'featureCount__child', 'public'),
    )
      .withProjection([
        ProjectionItem.of(
          'featureCount',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'value',
              new CodecJsonValueProjection(AggregateExpr.count(), {
                codecId: 'pg/int8number@1',
              }),
            ),
          ]),
        ),
      ])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('featureCount__child', 'id'),
          ColumnRef.of('features', 'assignee_id'),
        ),
      );

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Task',
      'tasks',
      rootState(include, 'Feature', 'title'),
    );

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([
          projection('title', 'tasks', 'title', 'pg/text@1'),
          ProjectionItem.of('featureCount', SubqueryExpr.of(scalarSelect)),
        ])
        .withJoins([featureJoin]),
    );
  });
});
