import type { NamespaceId } from '@internal/contract/types';
import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { createModelAccessor } from '../src/model-accessor';
import type {
  CreateInput,
  DefaultModelRow,
  InferRootRow,
  ResolvedCreateInput,
  VariantCreateInput,
  VariantModelRow,
} from '../src/types';
import type { PolyContract, PolyModels } from './fixtures/poly-contract';

test('InferRootRow for polymorphic base returns discriminated union', () => {
  type TaskRow = InferRootRow<PolyContract, 'Task'>;
  expectTypeOf<TaskRow>().toExtend<{ title: unknown; type: 'bug' | 'feature' }>();
});

test('InferRootRow discriminator field carries literal union type', () => {
  type TaskRow = InferRootRow<PolyContract, 'Task'>;
  expectTypeOf<TaskRow['type']>().toEqualTypeOf<'bug' | 'feature'>();
});

test('discriminator narrows to Bug fields exclusively', () => {
  type TaskRow = InferRootRow<PolyContract, 'Task'>;
  const r = {} as unknown as TaskRow;
  if (r.type === 'bug') {
    expectTypeOf<typeof r>().toHaveProperty('severity');
    // @ts-expect-error priority only exists on Feature variant
    r.priority;
  }
});

test('discriminator narrows to Feature fields exclusively', () => {
  type TaskRow = InferRootRow<PolyContract, 'Task'>;
  const r = {} as unknown as TaskRow;
  if (r.type === 'feature') {
    expectTypeOf<typeof r>().toHaveProperty('priority');
    // @ts-expect-error severity only exists on Bug variant
    r.severity;
  }
});

test('InferRootRow for non-polymorphic model equals DefaultModelRow', () => {
  type PlainRow = InferRootRow<PolyContract, 'PlainModel'>;
  type Expected = DefaultModelRow<PolyContract, 'PlainModel'>;
  expectTypeOf<PlainRow>().toEqualTypeOf<Expected>();
});

test('DefaultModelRow still works for non-polymorphic model', () => {
  type PlainRow = DefaultModelRow<PolyContract, 'PlainModel'>;
  expectTypeOf<PlainRow>().toHaveProperty('id');
  expectTypeOf<PlainRow>().toHaveProperty('name');
});

test('Collection default Row for polymorphic model is discriminated union', () => {
  type TaskCollection = Collection<PolyContract, 'Task'>;
  type TaskRow = TaskCollection extends { all(): infer R }
    ? R extends AsyncIterable<infer T>
      ? T
      : never
    : never;
  expectTypeOf<TaskRow['type']>().toEqualTypeOf<'bug' | 'feature'>();
});

test('Collection default Row for non-polymorphic model equals DefaultModelRow', () => {
  type PlainCollection = Collection<PolyContract, 'PlainModel'>;
  type PlainRow = PlainCollection extends { all(): infer R }
    ? R extends AsyncIterable<infer T>
      ? T
      : never
    : never;
  type Expected = DefaultModelRow<PolyContract, 'PlainModel'>;
  expectTypeOf<PlainRow>().toEqualTypeOf<Expected>();
});

// ---------------------------------------------------------------------------
// Write gating: polymorphic base create = never, variant create excludes discriminator
// ---------------------------------------------------------------------------

test('ResolvedCreateInput for polymorphic base (no variant) is never', () => {
  type BaseCreate = ResolvedCreateInput<PolyContract, 'Task', undefined>;
  expectTypeOf<BaseCreate>().toBeNever();
});

test('CreateInput for non-polymorphic model is unchanged', () => {
  type PlainCreate = CreateInput<PolyContract, 'PlainModel'>;
  expectTypeOf<PlainCreate>().toHaveProperty('id');
  expectTypeOf<PlainCreate>().toHaveProperty('name');
});

test('ResolvedCreateInput for non-polymorphic model equals CreateInput', () => {
  type Resolved = ResolvedCreateInput<PolyContract, 'PlainModel', undefined>;
  type Plain = CreateInput<PolyContract, 'PlainModel'>;
  expectTypeOf<Resolved>().toEqualTypeOf<Plain>();
});

test('VariantCreateInput includes base + variant fields minus discriminator', () => {
  type BugCreate = VariantCreateInput<PolyContract, 'Task', 'Bug'>;
  expectTypeOf<BugCreate>().toHaveProperty('title');
  expectTypeOf<BugCreate>().toHaveProperty('severity');
  expectTypeOf<BugCreate>().not.toHaveProperty('type');
});

test('VariantCreateInput for MTI variant includes base + variant fields minus discriminator', () => {
  type FeatureCreate = VariantCreateInput<PolyContract, 'Task', 'Feature'>;
  expectTypeOf<FeatureCreate>().toHaveProperty('title');
  expectTypeOf<FeatureCreate>().toHaveProperty('priority');
  expectTypeOf<FeatureCreate>().not.toHaveProperty('type');
});

test('ResolvedCreateInput with variant name equals VariantCreateInput', () => {
  type Resolved = ResolvedCreateInput<PolyContract, 'Task', 'Bug'>;
  type Direct = VariantCreateInput<PolyContract, 'Task', 'Bug'>;
  expectTypeOf<Resolved>().toEqualTypeOf<Direct>();
});

// ---------------------------------------------------------------------------
// Include narrowing: a polymorphic-target relation surfaces the variant union
// by default, and `r.variant('x')` narrows the included value to variant X.
// ---------------------------------------------------------------------------

type RowOfCollection<TCollection> = TCollection extends { all(): infer R }
  ? R extends AsyncIterable<infer T>
    ? T
    : never
  : never;

declare const projects: Collection<PolyContract, 'Project'>;

test('include of a polymorphic-target relation types the value as the variant union', () => {
  const withTasks = projects.include('tasks');
  type Included = RowOfCollection<typeof withTasks>['tasks'];
  expectTypeOf<Included>().toExtend<readonly unknown[]>();
  type Element = Included[number];
  expectTypeOf<Element['type']>().toEqualTypeOf<'bug' | 'feature'>();
});

test('include without refinement narrows each variant exclusively by discriminator', () => {
  const withTasks = projects.include('tasks');
  type Included = RowOfCollection<typeof withTasks>['tasks'];
  const element = {} as unknown as Included[number];
  if (element.type === 'bug') {
    expectTypeOf<typeof element>().toHaveProperty('severity');
    // @ts-expect-error priority only exists on the Feature variant
    element.priority;
  }
  if (element.type === 'feature') {
    expectTypeOf<typeof element>().toHaveProperty('priority');
    // @ts-expect-error severity only exists on the Bug variant
    element.severity;
  }
});

test('r.variant("bug") on an include refinement narrows the value to the Bug variant', () => {
  const refined = projects.include('tasks', (tasks) => tasks.variant('bug'));
  type Included = RowOfCollection<typeof refined>['tasks'];
  type Element = Included[number];
  expectTypeOf<Element['type']>().toEqualTypeOf<'bug'>();
  expectTypeOf<Element>().toHaveProperty('severity');
  expectTypeOf<Element>().not.toHaveProperty('priority');
});

test('r.variant("feature") on an include refinement narrows the value to the Feature variant', () => {
  const refined = projects.include('tasks', (tasks) => tasks.variant('feature'));
  type Included = RowOfCollection<typeof refined>['tasks'];
  type Element = Included[number];
  expectTypeOf<Element['type']>().toEqualTypeOf<'feature'>();
  expectTypeOf<Element>().toHaveProperty('priority');
  expectTypeOf<Element>().not.toHaveProperty('severity');
});

// ---------------------------------------------------------------------------
// Variant-aware predicate accessor: inside `t.variant('x').where(...)` the
// predicate model exposes variant X's fields (MTI variant columns included).
// ---------------------------------------------------------------------------

test('where after variant("feature") exposes the MTI variant field on the predicate model', () => {
  projects.include('tasks', (tasks) =>
    tasks.variant('feature').where((task) => {
      expectTypeOf(task).toHaveProperty('priority');
      expectTypeOf(task).toHaveProperty('title');
      return task.priority.gte(3);
    }),
  );
});

test('where after variant("bug") exposes the Bug variant field and rejects the other variant field', () => {
  projects.include('tasks', (tasks) =>
    tasks.variant('bug').where((task) => {
      expectTypeOf(task).toHaveProperty('severity');
      // @ts-expect-error priority belongs to the Feature variant, not Bug
      task.priority;
      return task.severity.isNull();
    }),
  );
});

test('where without a variant exposes only base fields on the predicate model', () => {
  projects.include('tasks', (tasks) =>
    tasks.where((task) => {
      expectTypeOf(task).toHaveProperty('title');
      // @ts-expect-error priority is an MTI variant field, absent on the base predicate model
      task.priority;
      return task.title.isNotNull();
    }),
  );
});

// ---------------------------------------------------------------------------
// Variant-declared relations: `t.variant('x').where(...)` exposes a relation
// declared on variant X, alongside relations declared on the base model.
// ---------------------------------------------------------------------------

test('where after variant("feature") exposes the MTI variant relation and keeps a base relation', () => {
  projects.include('tasks', (tasks) =>
    tasks.variant('feature').where((task) => {
      expectTypeOf(task).toHaveProperty('assignee');
      expectTypeOf(task).toHaveProperty('subtasks');
      return task.assignee.some();
    }),
  );
});

test('where after variant("bug") exposes the STI variant relation', () => {
  projects.include('tasks', (tasks) =>
    tasks.variant('bug').where((task) => {
      expectTypeOf(task).toHaveProperty('assignee');
      return task.assignee.some();
    }),
  );
});

test('where without a variant does not expose the variant-declared relation', () => {
  projects.include('tasks', (tasks) =>
    tasks.where((task) => {
      // @ts-expect-error assignee is a variant-declared relation, absent on the base predicate model
      task.assignee;
      return task.title.isNotNull();
    }),
  );
});

// ---------------------------------------------------------------------------
// `first()` mirrors `where()`: its callback predicate is variant-aware, so
// `t.variant('x').first(t => t.variantField…)` exposes variant X's fields.
// ---------------------------------------------------------------------------

declare const tasks: Collection<PolyContract, 'Task'>;
declare const plainModels: Collection<PolyContract, 'PlainModel'>;
declare const executionContext: ExecutionContext<PolyContract>;

test('prepared terminals retain variant unions, narrowing and nested projections', () => {
  const all = tasks.prepared.all();
  expectTypeOf(all.consume).returns.toEqualTypeOf<
    AsyncIterableResult<InferRootRow<PolyContract, 'Task'>>
  >();
  const selected = tasks.variant('bug');
  const first = selected.prepared.first((task) => {
    expectTypeOf(task.severity).not.toBeNever();
    // @ts-expect-error priority belongs to the other variant
    task.priority;
    return task.severity.eq('high');
  });
  expectTypeOf(first.consume).returns.toEqualTypeOf<
    Promise<RowOfCollection<typeof selected> | null>
  >();
  type Selected = RowOfCollection<typeof selected>;
  expectTypeOf<Selected['type']>().toEqualTypeOf<'bug'>();
  expectTypeOf<Selected>().toHaveProperty('severity');
  expectTypeOf<Selected>().not.toHaveProperty('priority');
  const nested = projects.select('name').include('tasks', (tasks) => tasks.variant('feature'));
  const nestedAll = nested.prepared.all();
  expectTypeOf(nestedAll.consume).returns.toEqualTypeOf<
    AsyncIterableResult<RowOfCollection<typeof nested>>
  >();
  expectTypeOf<
    RowOfCollection<typeof nested>['tasks'][number]['type']
  >().toEqualTypeOf<'feature'>();
});

test('first after variant("feature") exposes the MTI variant field on the predicate model', () => {
  tasks.variant('feature').first((task) => {
    expectTypeOf(task).toHaveProperty('priority');
    expectTypeOf(task).toHaveProperty('title');
    return task.priority.gte(3);
  });
});

test('first after variant("bug") exposes the Bug variant field and rejects the other variant field', () => {
  tasks.variant('bug').first((task) => {
    expectTypeOf(task).toHaveProperty('severity');
    // @ts-expect-error priority belongs to the Feature variant, not Bug
    task.priority;
    return task.severity.isNull();
  });
});

test('first without a variant exposes only base fields on the predicate model', () => {
  tasks.first((task) => {
    expectTypeOf(task).toHaveProperty('title');
    // @ts-expect-error priority is an MTI variant field, absent on the base predicate model
    task.priority;
    return task.title.isNotNull();
  });
});

// ---------------------------------------------------------------------------
// `orderBy()` mirrors `where()`/`first()`: its selector is variant-aware, so
// `t.variant('x').orderBy(t => t.variantField…)` exposes variant X's fields.
// ---------------------------------------------------------------------------

test('orderBy after variant("feature") exposes the MTI variant field on the selector model', () => {
  tasks.variant('feature').orderBy((task) => {
    expectTypeOf(task).toHaveProperty('priority');
    expectTypeOf(task).toHaveProperty('title');
    return task.priority.asc();
  });
});

test('orderBy after variant("bug") exposes the Bug variant field and rejects the other variant field', () => {
  tasks.variant('bug').orderBy((task) => {
    expectTypeOf(task).toHaveProperty('severity');
    // @ts-expect-error priority belongs to the Feature variant, not Bug
    task.priority;
    return task.severity.asc();
  });
});

test('orderBy without a variant exposes only base fields on the selector model', () => {
  tasks.orderBy((task) => {
    expectTypeOf(task).toHaveProperty('title');
    // @ts-expect-error priority is an MTI variant field, absent on the base selector model
    task.priority;
    return task.title.asc();
  });
});

test('orderBy after variant("feature") on an include refinement exposes the MTI variant field', () => {
  projects.include('tasks', (tasks) =>
    tasks.variant('feature').orderBy((task) => {
      expectTypeOf(task).toHaveProperty('priority');
      return task.priority.desc();
    }),
  );
});

test('createModelAccessor with a selected variant returns a variant-aware accessor', () => {
  const task = createModelAccessor(executionContext, '__unbound__', 'Task', 'Feature');
  expectTypeOf(task).toHaveProperty('priority');
  expectTypeOf(task).toHaveProperty('title');
  task.priority.gte(3);
});

test('createModelAccessor without a selected variant returns the base accessor', () => {
  const task = createModelAccessor(executionContext, '__unbound__', 'Task');
  expectTypeOf(task).toHaveProperty('title');
  // @ts-expect-error priority is an MTI variant field, absent without a selected variant
  task.priority;
});

// ---------------------------------------------------------------------------
// Variant-declared includes: a singleton variant owns its declared relations,
// while union-valued narrowing exposes only base relations safe for every
// possible runtime variant.
// ---------------------------------------------------------------------------

test('include after variant("feature") uses the MTI variant relation owner', () => {
  const included = tasks.variant('feature').include('assignee');
  type Assignee = RowOfCollection<typeof included>['assignee'];
  expectTypeOf<Assignee>().toEqualTypeOf<DefaultModelRow<PolyContract, 'Assignee'> | null>();
});

test('include after variant("bug") uses the STI variant relation owner', () => {
  const included = tasks.variant('bug').include('assignee');
  type Assignee = RowOfCollection<typeof included>['assignee'];
  expectTypeOf<Assignee>().toEqualTypeOf<DefaultModelRow<PolyContract, 'Assignee'> | null>();
});

test('include after variant("feature") keeps an unshadowed base relation', () => {
  const included = tasks.variant('feature').include('subtasks');
  type Subtasks = RowOfCollection<typeof included>['subtasks'];
  expectTypeOf<Subtasks>().toExtend<readonly unknown[]>();
  expectTypeOf<Subtasks[number]['type']>().toEqualTypeOf<'bug' | 'feature'>();
});

test('include without narrowing rejects a variant-declared relation', () => {
  // @ts-expect-error assignee is declared only by Task variants
  tasks.include('assignee');
});

declare const taskVariantValue: 'bug' | 'feature';

test('variant accepts a declared discriminator value', () => {
  const bugs = tasks.variant('bug');
  expectTypeOf<RowOfCollection<typeof bugs>['type']>().toEqualTypeOf<'bug'>();
});

test('variant rejects a variant model name', () => {
  // @ts-expect-error variant() takes a discriminator value, not a model name
  tasks.variant('Bug');
});

test('variant rejects an undeclared discriminator value', () => {
  // @ts-expect-error 'epic' is not a declared discriminator value of Task
  tasks.variant('epic');
});

test('variant cannot be called on a non-polymorphic receiver', () => {
  // @ts-expect-error PlainModel declares no discriminator values
  plainModels.variant('bug');
});

test('variant can be called on a collection with no variant selected', () => {
  const ordered = tasks.orderBy((task) => task.id.desc());
  expectTypeOf(ordered.variant('bug')).not.toBeNever();
  expectTypeOf(tasks.variant(taskVariantValue)).not.toBeNever();
});

test('variant cannot be called on a collection with a variant selected', () => {
  const bugs = tasks.variant('bug');
  // @ts-expect-error a variant is already selected; select from the base collection
  bugs.variant('feature');
  // @ts-expect-error a variant is already selected, even when it is a union
  tasks.variant(taskVariantValue).variant('bug');
});

class TaskCollection extends Collection<PolyContract, 'Task'> {
  bugs() {
    return this.variant('bug');
  }
}

declare const taskCollection: TaskCollection;

test('a variant helper result rejects a second variant selection', () => {
  const bugs = taskCollection.bugs();
  expectTypeOf(bugs.where((task) => task.severity.eq('high'))).not.toBeNever();
  // @ts-expect-error bugs() already selected a variant
  bugs.variant('feature');
});

test('a zero-argument custom helper exposes the variant row and create input', () => {
  const bugs = taskCollection.bugs();
  expectTypeOf<RowOfCollection<typeof bugs>>().toEqualTypeOf<
    VariantModelRow<PolyContract, 'Task', 'Bug'>
  >();
  type BugsState =
    typeof bugs extends Collection<PolyContract, 'Task', infer _Row, infer State> ? State : never;
  expectTypeOf<BugsState['variantName']>().toEqualTypeOf<'Bug'>();
});

test('create() on a zero-argument custom helper takes the variant create input', () => {
  const bugs = taskCollection.bugs();
  expectTypeOf(bugs.create({ id: 1, title: 'Crash', severity: 'high' })).resolves.toEqualTypeOf<
    VariantModelRow<PolyContract, 'Task', 'Bug'>
  >();
  // @ts-expect-error priority belongs to the Feature variant
  bugs.create({ id: 1, title: 'Crash', severity: 'high', priority: 1 });
  // @ts-expect-error the discriminator is set by the variant, not by the caller
  bugs.create({ id: 1, title: 'Crash', severity: 'high', type: 'bug' });
});

test('include after union-valued narrowing keeps an unshadowed base relation', () => {
  const included = tasks.variant(taskVariantValue).include('subtasks');
  type Subtasks = RowOfCollection<typeof included>['subtasks'];
  expectTypeOf<Subtasks>().toExtend<readonly unknown[]>();
});

test('include after union-valued narrowing rejects variant-owned relations', () => {
  // @ts-expect-error union-valued variant state exposes no variant-owned includes
  tasks.variant(taskVariantValue).include('assignee');
});

type CollisionModels = Omit<PolyModels, 'Task' | 'Bug' | 'Feature'> & {
  readonly Task: Omit<PolyModels['Task'], 'relations'> & {
    readonly relations: PolyModels['Task']['relations'] & {
      readonly owner: {
        readonly to: {
          readonly namespace: '__unbound__' & NamespaceId;
          readonly model: 'Assignee';
        };
        readonly cardinality: '1:N';
        readonly on: {
          readonly localFields: readonly ['id'];
          readonly targetFields: readonly ['id'];
        };
      };
      readonly blocked: {
        readonly to: {
          readonly namespace: '__unbound__' & NamespaceId;
          readonly model: 'Assignee';
        };
        readonly cardinality: '1:N';
        readonly on: {
          readonly localFields: readonly ['id'];
          readonly targetFields: readonly ['id'];
        };
      };
    };
  };
  readonly Feature: Omit<PolyModels['Feature'], 'relations'> & {
    readonly relations: PolyModels['Feature']['relations'] & {
      readonly owner: {
        readonly to: { readonly namespace: '__unbound__' & NamespaceId; readonly model: 'Task' };
        readonly cardinality: 'N:1';
        readonly nullable: true;
        readonly on: {
          readonly localFields: readonly ['assigneeId'];
          readonly targetFields: readonly ['id'];
        };
      };
    };
  };
  readonly Bug: Omit<PolyModels['Bug'], 'relations'> & {
    readonly relations: PolyModels['Bug']['relations'] & {
      readonly blocked: never;
    };
  };
};

type CollisionContract = Omit<PolyContract, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: CollisionModels };
    };
  };
};

declare const collisionTasks: Collection<CollisionContract, 'Task'>;

test('singleton variant include chooses its shadowing target and cardinality', () => {
  const included = collisionTasks.variant('feature').include('owner');
  type Owner = RowOfCollection<typeof included>['owner'];
  expectTypeOf<Owner>().not.toExtend<readonly unknown[]>();
  expectTypeOf<NonNullable<Owner>>().toHaveProperty('title');
});

test('union-valued narrowing rejects a base relation shadowed by one possible variant', () => {
  // @ts-expect-error Feature shadows owner, so the base owner relation is not common-safe
  collisionTasks.variant(taskVariantValue).include('owner');
});

test('non-navigable variant declaration shadows a same-named base relation', () => {
  // @ts-expect-error Bug declares blocked as non-navigable and must not fall back to Task.blocked
  collisionTasks.variant('bug').include('blocked');
});

test('singleton variant keeps a base relation not declared by that variant', () => {
  collisionTasks.variant('feature').include('blocked');
});

test('union-valued narrowing rejects a base relation shadowed by a non-navigable member', () => {
  // @ts-expect-error Bug shadows blocked, so it is unsafe for Bug | Feature state
  collisionTasks.variant(taskVariantValue).include('blocked');
});
