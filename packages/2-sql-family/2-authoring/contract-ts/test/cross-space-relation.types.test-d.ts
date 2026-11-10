import type { ContractRelation } from '@internal/contract/types';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { expectTypeOf, test } from 'vitest';
import { extensionModel, field, model, rel } from '../src/contract-builder';
import type { SqlContractResult } from '../src/contract-types';
import { columnDescriptor } from './helpers/column-descriptor';

declare const family: FamilyPackRef<'sql'>;
declare const target: TargetPackRef<'sql', 'postgres'> & { readonly defaultNamespaceId: 'public' };
declare const supabase: ExtensionPackRef<'sql', 'postgres'>;

const int4 = columnDescriptor('pg/int4@1');

const ForeignUser = extensionModel(
  'User',
  { namespace: 'auth', fields: { id: field.column(int4).id() }, table: 'users' },
  'supabase',
);
const User = model('User', { fields: { id: field.column(int4).id() } });
const Profile = model('Profile', {
  fields: { id: field.column(int4).id(), userId: field.column(int4), ownerId: field.column(int4) },
}).relations({
  account: rel.belongsTo(ForeignUser, { from: 'userId', to: 'id' }),
  owner: rel.belongsTo(User, { from: 'ownerId', to: 'id' }),
});

type Contract = SqlContractResult<{
  readonly family: typeof family;
  readonly target: typeof target;
  readonly extensions: { readonly supabase: typeof supabase };
  readonly models: { readonly User: typeof User; readonly Profile: typeof Profile };
}>;
type Relations = Contract['domain']['namespaces']['public']['models']['Profile']['relations'];

test('a relation to a model of another contract space keeps the general type', () => {
  expectTypeOf<Relations['account']>().toEqualTypeOf<ContractRelation>();
});

test('a relation to a model of this contract with the same name is typed from it', () => {
  expectTypeOf<Relations['owner']['to']['model']>().toEqualTypeOf<'User'>();
  expectTypeOf<Relations['owner']['cardinality']>().toEqualTypeOf<'N:1'>();
});
