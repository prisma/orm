import { expectTypeOf } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

type SoleNamespaceModels<
  T extends { domain: { namespaces: Record<string, { models: unknown }> } },
> = T['domain']['namespaces'][keyof T['domain']['namespaces']]['models'];

// @ts-expect-error — capabilities are contributed by components, not authoring input
defineContract({ capabilities: { sql: { lateral: true } } });

// @ts-expect-error — SQLite has no namespaces
defineContract({ namespaces: ['aux'] });

// @ts-expect-error — SQLite has no namespaces
defineContract({ namespaces: ['aux'] }, () => ({}));

const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'sqlite'>();
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
expectTypeOf(withModel.target).toEqualTypeOf<'sqlite'>();
expectTypeOf<SoleNamespaceModels<typeof withModel>['User']>().not.toBeNever();

const withFactory = defineContract({}, ({ model: m, field: f, gen, type }) => ({
  models: {
    Post: m('Post', { fields: { id: f.column(type.sql.Char(36)).id().onCreate(gen.uuid()) } }),
  },
}));
expectTypeOf(withFactory.target).toEqualTypeOf<'sqlite'>();
expectTypeOf<SoleNamespaceModels<typeof withFactory>['Post']>().not.toBeNever();
