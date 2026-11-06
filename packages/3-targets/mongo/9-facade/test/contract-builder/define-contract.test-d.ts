import mongoFamilyPack from '@internal/family-mongo/pack';
import mongoTargetPack from '@internal/target-mongo/pack';
import { expectTypeOf } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

type SoleNamespaceModels<
  T extends { domain: { namespaces: Record<string, { models: unknown }> } },
> = T['domain']['namespaces'][keyof T['domain']['namespaces']]['models'];

// @ts-expect-error — family is no longer accepted; the facade pre-binds it
defineContract({ family: mongoFamilyPack, extensions: undefined });

// @ts-expect-error — target is no longer accepted; the facade pre-binds it
defineContract({ target: mongoTargetPack, extensions: undefined });

// Literal target and targetFamily are preserved on the result
const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'mongo'>();
expectTypeOf(result.targetFamily).toEqualTypeOf<'mongo'>();

// Model-shape inference flows through the return type (definition form)
const withModel = defineContract({
  models: {
    User: model('User', { fields: { id: field.objectId() } }),
  },
});
expectTypeOf(withModel.target).toEqualTypeOf<'mongo'>();
expectTypeOf<SoleNamespaceModels<typeof withModel>['User']>().not.toBeNever();

// Model-shape inference flows through the return type (factory form)
const withFactory = defineContract({}, ({ model: m, field: f }) => ({
  models: {
    Post: m('Post', { fields: { id: f.objectId() } }),
  },
}));
expectTypeOf(withFactory.target).toEqualTypeOf<'mongo'>();
expectTypeOf<SoleNamespaceModels<typeof withFactory>['Post']>().not.toBeNever();
