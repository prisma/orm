import fc from 'fast-check';
import {
  type Command,
  type FieldShape,
  type Filter,
  type Included,
  type IncludeTree,
  type Key,
  type ModelShape,
  modelOf,
  type NewRelated,
  type NewRow,
  type Quantifier,
  type RelatedChange,
  type RelationShape,
  relationOf,
  type Scalars,
  type SchemaShape,
  type Sequence,
  type Shape,
  scoped,
} from './programs';
import { unusedOrdinals } from './scalar-types';

export interface CommandOptions {
  readonly schema: SchemaShape;
  readonly generatedKeys: boolean;
}

type Tie = (key: string) => fc.Arbitrary<unknown>;

const nesting = { depthIdentifier: 'nesting', depthSize: 'medium' } as const;
const including = { depthIdentifier: 'including', depthSize: 'small' } as const;
const filtering = { depthIdentifier: 'filtering', depthSize: 'small' } as const;

function withoutUndefined<T>(record: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, T] => entry[1] !== undefined),
  );
}

function holders(model: ModelShape): RelationShape[] {
  return model.relations.filter((relation) => relation.foreignKey !== undefined);
}

function foreignKeyFields(model: ModelShape): string[] {
  return holders(model).flatMap((relation) => relation.foreignKey ?? []);
}

function ownUniqueFields(model: ModelShape): string[] {
  const linked = foreignKeyFields(model);
  return [...model.key, ...model.uniques.flat()].filter((name) => !linked.includes(name));
}

function valuesOf({ type, nullable }: FieldShape): fc.Arbitrary<unknown> {
  return nullable ? fc.option(type.values, { nil: null, freq: 4 }) : type.values;
}

function valuesOfNewRow(model: ModelShape, field: FieldShape): fc.Arbitrary<unknown> {
  const { distinct } = field.type;
  if (distinct === undefined || !ownUniqueFields(model).includes(field.name)) {
    return valuesOf(field);
  }
  return fc.oneof(
    { weight: 1, arbitrary: field.type.values },
    { weight: 4, arbitrary: unusedOrdinals.map(distinct) },
  );
}

function recordOf(
  fields: readonly FieldShape[],
  values: (field: FieldShape) => fc.Arbitrary<unknown>,
): fc.Arbitrary<Record<string, unknown>> {
  return fc.record(Object.fromEntries(fields.map((field) => [field.name, values(field)])));
}

function fieldsNamed(model: ModelShape, names: readonly string[]): FieldShape[] {
  return model.fields.filter((field) => names.includes(field.name));
}

function keyOf(model: ModelShape): fc.Arbitrary<Key> {
  return fc.oneof(
    { weight: 3, arbitrary: recordOf(fieldsNamed(model, model.key), ({ type }) => type.values) },
    ...model.uniques.map((unique) => ({
      weight: 1,
      arbitrary: recordOf(fieldsNamed(model, unique), ({ type }) => type.values),
    })),
  );
}

function fieldFilterOf(model: ModelShape): fc.Arbitrary<Filter> {
  return fc.oneof(
    ...model.fields.flatMap((field): fc.Arbitrary<Filter>[] => [
      ...(field.type.equatable
        ? [
            fc.record({
              kind: fc.constant('equals' as const),
              field: fc.constant(field.name),
              value: valuesOf(field),
            }),
          ]
        : []),
      ...(field.nullable
        ? [fc.record({ kind: fc.constant('isNull' as const), field: fc.constant(field.name) })]
        : []),
      ...(field.type.distinct === undefined
        ? []
        : [
            fc.record({
              kind: fc.constant('in' as const),
              field: fc.constant(field.name),
              values: fc.array(field.type.values, { minLength: 1, maxLength: 4 }),
            }),
          ]),
    ]),
  );
}

function changesOf(model: ModelShape, excluded: readonly string[]): fc.Arbitrary<Scalars> {
  const changeable = model.fields.filter((field) => !excluded.includes(field.name));
  return fc
    .record(
      Object.fromEntries(changeable.map((field) => [field.name, valuesOfNewRow(model, field)])),
      { requiredKeys: [] },
    )
    .map(withoutUndefined);
}

function fullRowOf(model: ModelShape): fc.Arbitrary<Scalars> {
  return recordOf(model.fields, (field) => valuesOfNewRow(model, field));
}

function withoutSelect(shape: Shape): Shape {
  return { ...shape, select: undefined };
}

function scopesOf(model: ModelShape): (string | undefined)[] {
  return [undefined, ...model.variants.map((variant) => variant.value)];
}

function writableScopesOf(model: ModelShape): (string | undefined)[] {
  return model.variants.length === 0 ? [undefined] : model.variants.map((variant) => variant.value);
}

function scopeKey(model: string, variant: string | undefined): string {
  return `${model}/${variant ?? ''}`;
}

function rowKey(model: string, variant: string | undefined, reachedThrough: string | undefined) {
  return `row/${scopeKey(model, variant)}/${reachedThrough ?? ''}`;
}

function includeKey(model: string): string {
  return `include/${model}`;
}

function filterKey(model: string, variant: string | undefined): string {
  return `filter/${scopeKey(model, variant)}`;
}

type Link =
  | { readonly kind: 'scalars'; readonly values: Record<string, unknown> }
  | { readonly kind: 'omitted' }
  | NewRelated;

interface Taken {
  readonly values: Set<string>;
  next: number;
}

export function commands({ schema, generatedKeys }: CommandOptions): fc.Arbitrary<Sequence> {
  function filterOf(tie: Tie, model: ModelShape, variant: string | undefined) {
    return tie(filterKey(model.name, variant)) as fc.Arbitrary<Filter>;
  }

  function anyScopeOf(model: ModelShape): fc.Arbitrary<string | undefined> {
    return fc.constantFrom(...scopesOf(model));
  }

  function newRelated(tie: Tie, relation: RelationShape): fc.Arbitrary<NewRelated> {
    const most = relation.many ? 2 : 1;
    const target = modelOf(schema, relation.to);
    return fc.oneof(
      nesting,
      fc.record({
        kind: fc.constant('connect' as const),
        variant: anyScopeOf(target),
        keys: fc.array(keyOf(target), { minLength: 1, maxLength: most }),
      }),
      ...writableScopesOf(target).map((variant) =>
        fc.record({
          kind: fc.constant('create' as const),
          variant: fc.constant(variant),
          rows: fc.array(
            tie(rowKey(target.name, variant, relation.inverse)) as fc.Arbitrary<NewRow>,
            { minLength: 1, maxLength: most, ...nesting },
          ),
        }),
      ),
    );
  }

  function newRow(
    tie: Tie,
    base: ModelShape,
    variant: string | undefined,
    reachedThrough: string | undefined,
  ): fc.Arbitrary<NewRow> {
    const model = scoped(base, variant);
    const linked = foreignKeyFields(model);
    const own = model.fields.filter((field) => !linked.includes(field.name));
    const others = model.relations.filter((relation) => relation.name !== reachedThrough);
    const holding = others.filter((relation) => relation.foreignKey !== undefined);
    const lists = others.filter((relation) => relation.foreignKey === undefined);
    return fc
      .record({
        own: recordOf(own, (field) => valuesOfNewRow(model, field)),
        generatedKey:
          generatedKeys && model.keyKind === 'generated' ? fc.boolean() : fc.constant(false),
        links: fc.record(
          Object.fromEntries(
            holding.map((relation): [string, fc.Arbitrary<Link>] => [
              relation.name,
              fc.oneof(
                nesting,
                ...(relation.required
                  ? []
                  : [fc.record({ kind: fc.constant('omitted' as const) })]),
                fc.record({
                  kind: fc.constant('scalars' as const),
                  values: recordOf(
                    fieldsNamed(model, relation.foreignKey ?? []),
                    ({ type }) => type.values,
                  ),
                }),
                newRelated(tie, relation),
                newRelated(tie, relation),
              ),
            ]),
          ),
        ),
        lists: fc.record(
          Object.fromEntries(
            lists.map((relation) => [
              relation.name,
              fc.option(newRelated(tie, relation), { nil: undefined, ...nesting }),
            ]),
          ),
        ),
      })
      .map(({ own: ownValues, generatedKey, links, lists: listed }) => {
        const scalars: Record<string, unknown> = { ...ownValues };
        if (generatedKey) for (const name of model.key) delete scalars[name];
        const related: Record<string, NewRelated> = withoutUndefined(listed);
        for (const [name, link] of Object.entries(links)) {
          if (link.kind === 'omitted') continue;
          if (link.kind === 'scalars') Object.assign(scalars, link.values);
          else related[name] = link;
        }
        return { scalars, related };
      });
  }

  function withDistinctKeys(row: NewRow, model: ModelShape, taken: Taken): NewRow {
    const scalars: Record<string, unknown> = { ...row.scalars };
    const replaceable = ownUniqueFields(model);
    for (const group of [model.key, ...model.uniques]) {
      if (group.some((name) => !(name in scalars))) continue;
      const identity = () =>
        `${model.name}/${group.join(',')}/${fc.stringify(group.map((name) => scalars[name]))}`;
      const changed = model.fields.find(
        (field) =>
          group.includes(field.name) &&
          replaceable.includes(field.name) &&
          field.type.distinct !== undefined,
      );
      if (taken.values.has(identity()) && changed?.type.distinct !== undefined) {
        scalars[changed.name] = changed.type.distinct(100 + taken.next);
        taken.next += 1;
      }
      taken.values.add(identity());
    }
    return {
      scalars,
      related: Object.fromEntries(
        Object.entries(row.related).map(([name, related]) => [
          name,
          distinctIn(model, name, related, taken),
        ]),
      ),
    };
  }

  function distinctIn<Change extends RelatedChange>(
    model: ModelShape,
    name: string,
    change: Change,
    taken: Taken,
  ): Change {
    if (change.kind !== 'create') return change;
    const to = modelOf(schema, relationOf(model, name).to);
    return { ...change, rows: change.rows.map((row) => withDistinctKeys(row, to, taken)) };
  }

  function relatedChanges(tie: Tie, relation: RelationShape): fc.Arbitrary<RelatedChange[]> {
    const target = modelOf(schema, relation.to);
    const inverse =
      relation.inverse === undefined ? undefined : relationOf(target, relation.inverse);
    const create: fc.Arbitrary<RelatedChange> = newRelated(tie, relation);
    const keys = fc.array(keyOf(target), { minLength: 1, maxLength: 3 });
    if (!relation.many) {
      const holds = relation.foreignKey !== undefined;
      const unlinkable = holds ? !relation.required : !inverse?.required;
      return fc
        .oneof(
          create,
          ...(unlinkable
            ? [
                fc.record({
                  kind: fc.constant('disconnect' as const),
                  variant: holds ? fc.constant(undefined) : anyScopeOf(target),
                  keys: fc.constant(undefined),
                }),
              ]
            : []),
        )
        .map((change) => [change]);
    }
    const disconnect: fc.Arbitrary<RelatedChange>[] =
      relation.kind === 'n:m'
        ? [
            fc.record({
              kind: fc.constant('disconnect' as const),
              variant: anyScopeOf(target),
              keys,
            }),
          ]
        : inverse?.required
          ? []
          : [
              fc.record({
                kind: fc.constant('disconnect' as const),
                variant: anyScopeOf(target),
                keys: fc.option(keys, { nil: undefined }),
              }),
            ];
    const filtered = scopesOf(target).flatMap((variant) => {
      const filter = fc.option(filterOf(tie, target, variant), { nil: undefined });
      return [
        {
          weight: 2,
          arbitrary: fc.record({
            kind: fc.constant('updateAll' as const),
            variant: fc.constant(variant),
            filter,
            changes: changesOf(scoped(target, undefined), [
              ...target.key,
              ...(inverse?.foreignKey ?? []),
            ]),
          }),
        },
        {
          weight: 1,
          arbitrary: fc.record({
            kind: fc.constant('deleteAll' as const),
            variant: fc.constant(variant),
            filter,
          }),
        },
      ];
    });
    return fc.array(
      fc.oneof(
        { weight: 2, arbitrary: create },
        ...disconnect.map((arbitrary) => ({ weight: 2, arbitrary })),
        ...filtered,
      ),
      { minLength: 1, maxLength: 3 },
    );
  }

  function shapeOf(tie: Tie, model: ModelShape): fc.Arbitrary<Shape> {
    return fc.record({
      select: fc.option(
        fc.subarray(
          model.fields.map((field) => field.name),
          { minLength: 1 },
        ),
        { nil: undefined, freq: 3 },
      ),
      include: tie(includeKey(model.name)) as fc.Arbitrary<IncludeTree>,
    });
  }

  function commandsOn(
    tie: Tie,
    base: ModelShape,
    variant: string | undefined,
  ): fc.Arbitrary<Command> {
    const model = scoped(base, variant);
    const unvaried = scoped(base, undefined);
    const writable = writableScopesOf(base).includes(variant);
    const inOwnTable = base.variants.some(
      (candidate) => candidate.value === variant && candidate.ownTable,
    );
    const on = {
      model: fc.constant(model.name),
      variant: fc.constant(variant),
      shape: shapeOf(tie, unvaried),
    };
    const counted = fc.boolean();
    const filter = filterOf(tie, base, variant);
    const also = fc.oneof(
      { weight: 3, arbitrary: fc.constant(undefined) },
      { weight: 1, arbitrary: filter },
    );
    const row = tie(rowKey(model.name, variant, undefined)) as fc.Arbitrary<NewRow>;
    const conflictTargets = [
      model.key,
      ...model.uniques.filter((unique) =>
        unique.every((name) => ownUniqueFields(model).includes(name)),
      ),
    ];
    const writes: fc.WeightedArbitrary<Command>[] = [
      {
        weight: 4,
        arbitrary: fc.record({
          ...on,
          kind: fc.constant('create' as const),
          row: row.map((created) =>
            withDistinctKeys(created, model, { values: new Set(), next: 0 }),
          ),
          ...(inOwnTable ? { shape: shapeOf(tie, unvaried).map(withoutSelect) } : {}),
        }),
      },
      {
        weight: 1,
        arbitrary: fc.record({
          ...on,
          kind: fc.constant('createAll' as const),
          rows: fc.array(fullRowOf(model), { minLength: 1, maxLength: 3 }),
          counted,
        }),
      },
      {
        weight: 2,
        arbitrary: fc.record({
          ...on,
          kind: fc.constant('upsert' as const),
          create: fullRowOf(model),
          update: changesOf(unvaried, model.key),
          conflictOn: fc.constantFrom(...conflictTargets),
        }),
      },
    ];
    return fc.oneof(
      ...(writable ? writes : []),
      {
        weight: 6,
        arbitrary: fc
          .record({
            ...on,
            kind: fc.constant('update' as const),
            key: keyOf(model),
            also,
            changes: fc.oneof(
              { weight: 4, arbitrary: changesOf(unvaried, model.key) },
              { weight: 1, arbitrary: changesOf(unvaried, []) },
            ),
            related: fc.record(
              Object.fromEntries(
                model.relations.map((relation) => [
                  relation.name,
                  fc.option(relatedChanges(tie, relation), { nil: undefined, freq: 2 }),
                ]),
              ),
            ),
          })
          .map((update) => {
            const taken: Taken = { values: new Set(), next: 0 };
            const related = Object.fromEntries(
              Object.entries(withoutUndefined(update.related)).map(([name, changes]) => [
                name,
                changes.map((change) => distinctIn(model, name, change, taken)),
              ]),
            );
            const linked = Object.keys(related).flatMap(
              (name) => relationOf(model, name).foreignKey ?? [],
            );
            const changes = Object.fromEntries(
              Object.entries(update.changes).filter(([name]) => !linked.includes(name)),
            );
            return { ...update, changes, related };
          }),
      },
      {
        weight: 2,
        arbitrary: fc.record({
          ...on,
          kind: fc.constant('updateAll' as const),
          filter,
          changes: changesOf(unvaried, model.key),
          counted,
        }),
      },
      {
        weight: 2,
        arbitrary: fc.record({
          ...on,
          kind: fc.constant('delete' as const),
          key: keyOf(model),
          also,
        }),
      },
      {
        weight: 1,
        arbitrary: fc.record({
          ...on,
          kind: fc.constant('deleteAll' as const),
          filter,
          counted,
        }),
      },
      {
        weight: 3,
        arbitrary: fc.record({
          ...on,
          kind: fc.constant('read' as const),
          filter: fc.option(filter, { nil: undefined }),
          limit: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
        }),
      },
    );
  }

  function existingRows(): fc.Arbitrary<Command[]> {
    return fc
      .record({
        candidates: fc.record(
          Object.fromEntries(
            schema.models.map((model) => [
              model.name,
              fc.array(
                fc.record({
                  own: recordOf(scoped(model, undefined).fields, (field) => valuesOf(field)),
                  ofVariant: fc.record(
                    Object.fromEntries(
                      model.variants.map((variant) => [
                        variant.value,
                        recordOf(variant.fields, (field) => valuesOf(field)),
                      ]),
                    ),
                  ),
                }),
                { minLength: 3, maxLength: 5 },
              ),
            ]),
          ),
        ),
        links: fc.array(fc.nat(), { minLength: 64, maxLength: 64 }),
      })
      .map(({ candidates, links }) => {
        let linked = 0;
        const nextLink = () => {
          linked += 1;
          return links[linked % links.length] ?? 0;
        };
        const stored: Record<string, Scalars[]> = {};
        const seeded: Command[] = [];
        const shape: Shape = { select: undefined, include: {} };
        for (const model of schema.models) {
          const rows: Scalars[] = [];
          const byVariant = new Map<string | undefined, Scalars[]>();
          const identities = new Set<string>();
          const scopes = writableScopesOf(model);
          let ordinal = 1;
          for (const candidate of candidates[model.name] ?? []) {
            const row: Record<string, unknown> = { ...candidate.own };
            for (const field of model.fields) {
              const { distinct } = field.type;
              const owned = model.uniques.flat().includes(field.name);
              if (owned && ownUniqueFields(model).includes(field.name) && distinct !== undefined) {
                row[field.name] = distinct(ordinal);
              }
            }
            ordinal += 1;
            let kept = true;
            for (const relation of holders(model)) {
              const target = modelOf(schema, relation.to);
              const parents = relation.to === model.name ? rows : (stored[relation.to] ?? []);
              const pick = nextLink();
              const parent =
                parents.length === 0 || (!relation.required && pick % 4 === 0)
                  ? undefined
                  : parents[pick % parents.length];
              (relation.foreignKey ?? []).forEach((name, index) => {
                row[name] = parent === undefined ? null : parent[target.key[index] ?? ''];
              });
              if (parent === undefined && relation.required) kept = false;
            }
            const groups = [model.key, ...model.uniques];
            const identitiesOfRow = groups.map(
              (group) => `${group.join(',')}/${fc.stringify(group.map((name) => row[name]))}`,
            );
            const free = groups.every(
              (group, index) =>
                group.some((name) => row[name] === null) ||
                !identities.has(identitiesOfRow[index] ?? ''),
            );
            if (!kept || !free) continue;
            for (const identity of identitiesOfRow) identities.add(identity);
            rows.push(row);
            const variant = scopes[nextLink() % scopes.length];
            const ofVariant = variant === undefined ? {} : candidate.ofVariant[variant];
            byVariant.set(variant, [...(byVariant.get(variant) ?? []), { ...row, ...ofVariant }]);
          }
          stored[model.name] = rows;
          for (const [variant, variantRows] of byVariant) {
            seeded.push({
              kind: 'createAll',
              model: model.name,
              variant,
              rows: variantRows,
              counted: !model.variants.some(
                (candidate) => candidate.value === variant && candidate.ownTable,
              ),
              shape,
            });
          }
        }
        return seeded;
      });
  }

  function aimedAtExistingRows(
    existing: readonly Command[],
    following: readonly Command[],
    picks: readonly number[],
  ): Command[] {
    let used = 0;
    const nextPick = () => {
      used += 1;
      return picks[used % picks.length] ?? 0;
    };
    const aimKey = (model: ModelShape, key: Key): Key => {
      const pick = nextPick();
      const rows = existing.flatMap((seeded) =>
        seeded.kind === 'createAll' && seeded.model === model.name ? seeded.rows : [],
      );
      const row = rows[pick % Math.max(rows.length, 1)];
      if (row === undefined || pick % 5 === 0) return key;
      return Object.fromEntries(model.key.map((name) => [name, row[name]]));
    };
    function aimRelated<Change extends RelatedChange>(
      model: ModelShape,
      name: string,
      change: Change,
    ): Change {
      const target = modelOf(schema, relationOf(model, name).to);
      if (change.kind === 'connect' || change.kind === 'disconnect') {
        return { ...change, keys: change.keys?.map((key) => aimKey(target, key)) };
      }
      if (change.kind === 'create') {
        return { ...change, rows: change.rows.map((row) => aimRow(target, row)) };
      }
      return change;
    }
    function aimRow(model: ModelShape, row: NewRow): NewRow {
      return {
        ...row,
        related: Object.fromEntries(
          Object.entries(row.related).map(([name, related]) => [
            name,
            aimRelated(model, name, related),
          ]),
        ),
      };
    }
    return following.map((next): Command => {
      const model = modelOf(schema, next.model);
      if (next.kind === 'create') return { ...next, row: aimRow(model, next.row) };
      if (next.kind === 'delete') return { ...next, key: aimKey(model, next.key) };
      if (next.kind !== 'update') return next;
      return {
        ...next,
        key: aimKey(model, next.key),
        related: Object.fromEntries(
          Object.entries(next.related).map(([name, changes]) => [
            name,
            changes.map((change) => aimRelated(model, name, change)),
          ]),
        ),
      };
    });
  }

  const { command } = fc.letrec<Record<string, unknown>>((tie) => {
    const scopes = schema.models.flatMap((model) =>
      scopesOf(model).map((variant) => ({ model, variant })),
    );
    const rows = scopes.flatMap(({ model, variant }) =>
      [undefined, ...model.relations.map((relation) => relation.name)].map((reachedThrough) => [
        rowKey(model.name, variant, reachedThrough),
        newRow(tie, model, variant, reachedThrough),
      ]),
    );
    const filters = scopes.map(({ model, variant }) => [
      filterKey(model.name, variant),
      fc.oneof(
        filtering,
        fieldFilterOf(scoped(model, variant)),
        ...model.relations.map((relation) =>
          fc.record({
            kind: fc.constant('related' as const),
            relation: fc.constant(relation.name),
            quantifier: fc.constantFrom<Quantifier>('some', 'none', 'every'),
            filter: fc.option(filterOf(tie, modelOf(schema, relation.to), undefined), {
              nil: undefined,
              freq: 4,
              ...filtering,
            }),
          }),
        ),
      ),
    ]);
    const includeTrees = schema.models.map((model) => [
      includeKey(model.name),
      fc
        .record(
          Object.fromEntries(
            model.relations.map((relation) => {
              const target = modelOf(schema, relation.to);
              const included: fc.Arbitrary<Included> = fc.record({
                filter: relation.many
                  ? fc.option(filterOf(tie, target, undefined), { nil: undefined, freq: 3 })
                  : fc.constant(undefined),
                limit: relation.many
                  ? fc.option(fc.integer({ min: 1, max: 2 }), { nil: undefined, freq: 3 })
                  : fc.constant(undefined),
                include: tie(includeKey(target.name)) as fc.Arbitrary<IncludeTree>,
              });
              return [
                relation.name,
                fc.option(included, { nil: undefined, freq: 2, ...including }),
              ];
            }),
          ),
        )
        .map(withoutUndefined),
    ]);
    return {
      ...Object.fromEntries(rows),
      ...Object.fromEntries(filters),
      ...Object.fromEntries(includeTrees),
      command: fc.oneof(...scopes.map(({ model, variant }) => commandsOn(tie, model, variant))),
    };
  });

  return fc
    .tuple(
      existingRows(),
      fc.array(command as fc.Arbitrary<Command>, { minLength: 1, maxLength: 8 }),
      fc.array(fc.nat(), { minLength: 32, maxLength: 32 }),
    )
    .map(([existing, following, picks]) => ({
      existing,
      following: aimedAtExistingRows(existing, following, picks),
    }));
}
