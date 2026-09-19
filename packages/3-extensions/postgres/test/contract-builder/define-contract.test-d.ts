import { expectTypeOf, test } from 'vitest';
import { defineContract, enumType, field, member, model } from '../../src/exports/contract-builder';

type SoleNamespaceModels<
  T extends { domain: { namespaces: Record<string, { models: unknown }> } },
> = T['domain']['namespaces'][keyof T['domain']['namespaces']]['models'];

// @ts-expect-error — capabilities are contributed by components, not authoring input
defineContract({ capabilities: { postgres: { lateral: true } } });

test('limits Date authoring to the temporal presets', () => {
  defineContract({}, ({ field: f }) => {
    expectTypeOf(f).not.toBeAny();
    expectTypeOf(f).not.toHaveProperty('dateTimeDate');
    expectTypeOf(f.temporal).not.toHaveProperty('timestamptzDate');
    expectTypeOf(f.temporal).not.toHaveProperty('createdAtDate');
    expectTypeOf(f.temporal).not.toHaveProperty('updatedAtDate');
    expectTypeOf(f.temporal).toHaveProperty('timestamptzJsDate');
    expectTypeOf(f.temporal).toHaveProperty('createdAtJsDate');
    expectTypeOf(f.temporal).toHaveProperty('updatedAtJsDate');
    return {};
  });
});

const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'postgres'>();
expectTypeOf(result.targetFamily).toEqualTypeOf<'sql'>();

const textColumn = {
  codecId: 'sql/char@1' as const,
  nativeType: 'character varying' as const,
  typeParams: {},
};
const withModel = defineContract({
  models: {
    User: model('User', { fields: { id: field.column(textColumn).id() } }),
  },
});
expectTypeOf(withModel.target).toEqualTypeOf<'postgres'>();
expectTypeOf<SoleNamespaceModels<typeof withModel>['User']>().not.toBeNever();

const withFactory = defineContract({}, ({ model: m, field: f }) => ({
  models: {
    Post: m('Post', { fields: { id: f.id.uuidv4String() } }),
  },
}));
expectTypeOf(withFactory.target).toEqualTypeOf<'postgres'>();
expectTypeOf<SoleNamespaceModels<typeof withFactory>['Post']>().not.toBeNever();

// Mixed scaffold + factory enums: the postgres wrapper must advertise both,
// mirroring the core defineContract merge (not collapse them into one generic).
const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;
const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
const Priority = enumType('Priority', pgText, member('Low', 'low'), member('High', 'high'));

const mixedEnums = defineContract({ enums: { Role } }, ({ model: m, field: f }) => ({
  enums: { Priority },
  models: {
    Item: m('Item', { fields: { id: f.id.uuidv4String() } }),
  },
}));
type MixedAccessors = typeof mixedEnums extends { enumAccessors: infer A } ? A : never;
expectTypeOf<MixedAccessors>().toHaveProperty('Role');
expectTypeOf<MixedAccessors>().toHaveProperty('Priority');
