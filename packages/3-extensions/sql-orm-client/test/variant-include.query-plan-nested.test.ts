import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  LiteralExpr,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { POLYMORPHIC_DISCRIMINATOR_ALIAS } from '../src/collection-contract';
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
  rowAggregate,
  selectedState,
  tasksInclude,
} from './variant-include.query-plan-fixtures';

describe('nested variant-owned include correlation', () => {
  it('uses the joined MTI table in a normal polymorphic child select', () => {
    const contract = buildMixedPolyContract();
    const nested = {
      ...selectedState('id', 'title', 'type'),
      includes: [assigneeInclude('features')],
      variantName: 'Feature',
    };
    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Project',
      'projects_tbl',
      { ...emptyState(), includes: [tasksInclude(nested)], selectedFields: ['name'] },
    );
    const childRows = childRowsFor(plan.ast, 'tasks');
    const assigneeAggregate = rowAggregate('assignee', assigneeRows('features', 'assignee_id'), [
      'id',
      'name',
    ]);

    expect(childRows).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([
          projection('id', 'tasks', 'id', 'pg/int4@1'),
          projection('title', 'tasks', 'title', 'pg/text@1'),
          projection('type', 'tasks', 'type', 'pg/text@1'),
          ProjectionItem.of('assignee', SubqueryExpr.of(assigneeAggregate)),
        ])
        .withWhere(
          BinaryExpr.eq(ColumnRef.of('tasks', 'project_id'), ColumnRef.of('projects_tbl', 'id')),
        )
        .withJoins([featureJoin]),
    );
  });

  it('uses forwarded MTI aliases after a distinct wrapper', () => {
    const contract = buildMixedPolyContract();
    const nested = {
      ...selectedState('title'),
      distinct: ['title'],
      includes: [assigneeInclude('features')],
      variantName: 'Feature',
    };
    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Project',
      'projects_tbl',
      { ...emptyState(), includes: [tasksInclude(nested)], selectedFields: ['name'] },
    );
    const childRows = childRowsFor(plan.ast, 'tasks');
    const baseProjection = [
      projection('title', 'tasks', 'title', 'pg/text@1'),
      projection('features__assignee_id', 'features', 'assignee_id', 'pg/int4@1'),
    ];
    const ranked = SelectAst.from(TableSource.named('tasks', undefined, 'public'))
      .withProjection([
        ...baseProjection,
        ProjectionItem.of(
          '__prisma_distinct_rn',
          WindowFuncExpr.rowNumber({
            partitionBy: [ColumnRef.of('tasks', 'title')],
            orderBy: [OrderByItem.asc(ColumnRef.of('tasks', 'title'))],
          }),
        ),
      ])
      .withWhere(
        BinaryExpr.eq(ColumnRef.of('tasks', 'project_id'), ColumnRef.of('projects_tbl', 'id')),
      )
      .withJoins([featureJoin]);
    const deduped = SelectAst.from(DerivedTableSource.as('tasks__ranked', ranked))
      .withProjection(
        baseProjection.map((item) =>
          ProjectionItem.of(item.alias, ColumnRef.of('tasks__ranked', item.alias), item.codec),
        ),
      )
      .withWhere(
        BinaryExpr.eq(ColumnRef.of('tasks__ranked', '__prisma_distinct_rn'), LiteralExpr.of(1)),
      );
    const assigneeAggregate = rowAggregate(
      'assignee',
      assigneeRows('tasks__distinct', 'features__assignee_id'),
      ['id', 'name'],
    );

    expect(childRows).toEqual(
      SelectAst.from(DerivedTableSource.as('tasks__distinct', deduped)).withProjection([
        projection('title', 'tasks__distinct', 'title', 'pg/text@1'),
        ProjectionItem.of('assignee', SubqueryExpr.of(assigneeAggregate)),
      ]),
    );
  });

  it('forwards selected MTI fields and a hidden discriminator through a distinct wrapper', () => {
    const contract = buildMixedPolyContract();
    const subtasks = includeExpr({
      relationName: 'subtasks',
      relatedModelName: 'Task',
      relatedTableName: 'tasks',
      localTableName: 'tasks',
      targetColumn: 'parent_id',
      localColumn: 'id',
      cardinality: '1:N',
      nested: selectedState('id'),
    });
    const nested = {
      ...selectedState('id', 'priority'),
      distinct: ['id'],
      includes: [subtasks],
    };
    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Project',
      'projects_tbl',
      { ...emptyState(), includes: [tasksInclude(nested)], selectedFields: ['name'] },
    );
    const childRows = childRowsFor(plan.ast, 'tasks');

    expect(childRows.from).toBeInstanceOf(DerivedTableSource);
    if (!(childRows.from instanceof DerivedTableSource)) {
      throw new Error('Expected distinct child rows to read from a derived table');
    }
    expect(childRows.from.query.projection.map((item) => item.alias)).toEqual([
      'id',
      'features__priority',
      POLYMORPHIC_DISCRIMINATOR_ALIAS,
    ]);
    expect(childRows.projection.map((item) => item.alias)).toEqual([
      'id',
      'features__priority',
      POLYMORPHIC_DISCRIMINATOR_ALIAS,
      'subtasks',
    ]);
  });

  it('correlates every composite M:N parent column through forwarded MTI aliases', () => {
    const contract = buildMixedPolyContract();
    const labels = includeExpr({
      relationName: 'labels',
      relatedModelName: 'Assignee',
      relatedTableName: 'assignees',
      localTableName: 'features',
      targetColumn: 'id',
      localColumn: 'priority',
      cardinality: 'N:M',
      nested: selectedState('id', 'name'),
      through: {
        table: 'project_links',
        namespaceId: 'public',
        parentColumns: ['src_tenant_id', 'src_id'],
        childColumns: ['dst_id'],
        targetColumns: ['id'],
        parentLocalColumns: ['priority', 'assignee_id'],
      },
    });
    const nested = {
      ...selectedState('title'),
      distinct: ['title'],
      includes: [labels],
      variantName: 'Feature',
    };
    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'Project',
      'projects_tbl',
      { ...emptyState(), includes: [tasksInclude(nested)], selectedFields: ['name'] },
    );
    const childRows = childRowsFor(plan.ast, 'tasks');
    const labelsProjection = childRows.projection.find((item) => item.alias === 'labels');
    expect(labelsProjection?.expr).toBeInstanceOf(SubqueryExpr);
    if (!(labelsProjection?.expr instanceof SubqueryExpr)) {
      throw new Error('Expected labels to be a correlated subquery');
    }
    const labelsRows = childRowsFor(
      SelectAst.from(TableSource.named('unused')).withProjection([labelsProjection]),
      'labels',
    );

    expect(labelsRows).toEqual(
      SelectAst.from(TableSource.named('assignees', undefined, 'public'))
        .withProjection([
          projection('id', 'assignees', 'id', 'pg/int4@1'),
          projection('name', 'assignees', 'name', 'pg/text@1'),
        ])
        .withWhere(
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'src_tenant_id'),
              ColumnRef.of('tasks__distinct', 'features__priority'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'src_id'),
              ColumnRef.of('tasks__distinct', 'features__assignee_id'),
            ),
          ]),
        )
        .withJoins([
          JoinAst.inner(
            TableSource.named('project_links', undefined, 'public'),
            BinaryExpr.eq(ColumnRef.of('project_links', 'dst_id'), ColumnRef.of('assignees', 'id')),
          ),
        ]),
    );
    expect(childRows.from).toBeInstanceOf(DerivedTableSource);
    if (!(childRows.from instanceof DerivedTableSource)) {
      throw new Error('Expected distinct child rows to read from a derived table');
    }
    expect(childRows.from.query.projection.map((item) => item.alias)).toEqual([
      'title',
      'features__priority',
      'features__assignee_id',
    ]);
    expect(childRows.projection.map((item) => item.alias)).toEqual(['title', 'labels']);
  });
});
