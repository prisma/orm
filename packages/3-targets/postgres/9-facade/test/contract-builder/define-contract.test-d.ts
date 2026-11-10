import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import { expectTypeOf, test } from 'vitest';
import { defineContract, enumType, field, member, model } from '../../src/exports/contract-builder';

type SoleNamespaceModels<
  T extends { domain: { namespaces: Record<string, { models: unknown }> } },
> = T['domain']['namespaces'][keyof T['domain']['namespaces']]['models'];

// @ts-expect-error — capabilities are contributed by components, not authoring input
defineContract({ capabilities: { postgres: { lateral: true } } });

test('limits Date authoring to the JsDate types', () => {
  defineContract({}, ({ type: t }) => {
    expectTypeOf(t).not.toBeAny();
    expectTypeOf(t).not.toHaveProperty('DateTimeDate');
    expectTypeOf(t).not.toHaveProperty('TimestamptzDate');
    expectTypeOf(t.temporal).not.toHaveProperty('CreatedAtDate');
    expectTypeOf(t.temporal).not.toHaveProperty('UpdatedAtDate');
    expectTypeOf(t).toHaveProperty('TimestamptzJsDate');
    expectTypeOf(t.temporal).not.toHaveProperty('CreatedAtJsDate');
    expectTypeOf(t.temporal).not.toHaveProperty('UpdatedAtJsDate');
    expectTypeOf(t.temporal).toHaveProperty('CreatedAt');
    expectTypeOf(t.temporal).toHaveProperty('UpdatedAt');
    return {};
  });
});

const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'postgres'>();
expectTypeOf(result.targetFamily).toEqualTypeOf<'sql'>();

const textColumn = {
  codecId: 'sql/char@1' as const,
  typeParams: {},
};
const withModel = defineContract({
  models: {
    User: model('User', { fields: { id: field.column(textColumn).id() } }),
  },
});
expectTypeOf(withModel.target).toEqualTypeOf<'postgres'>();
expectTypeOf<SoleNamespaceModels<typeof withModel>['User']>().not.toBeNever();

const withFactory = defineContract({}, ({ model: m, field: f, gen, type }) => ({
  models: {
    Post: m('Post', { fields: { id: f.column(type.Char(36)).id().onCreate(gen.uuid()) } }),
  },
}));
expectTypeOf(withFactory.target).toEqualTypeOf<'postgres'>();
expectTypeOf<SoleNamespaceModels<typeof withFactory>['Post']>().not.toBeNever();

// Mixed scaffold + factory enums: the postgres wrapper must advertise both,
// mirroring the core defineContract merge (not collapse them into one generic).
const pgText = { codecId: 'pg/text@1' as const } as const;
const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
const Priority = enumType('Priority', pgText, member('Low', 'low'), member('High', 'high'));

const mixedEnums = defineContract({ enums: { Role } }, ({ model: m, field: f, gen, type }) => ({
  enums: { Priority },
  models: {
    Item: m('Item', { fields: { id: f.column(type.Char(36)).id().onCreate(gen.uuid()) } }),
  },
}));
type MixedAccessors = NamespacedEnums<typeof mixedEnums>['public'];
expectTypeOf<MixedAccessors>().toHaveProperty('Role');
expectTypeOf<MixedAccessors>().toHaveProperty('Priority');
