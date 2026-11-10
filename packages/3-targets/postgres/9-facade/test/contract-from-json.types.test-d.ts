import { expectTypeOf, test } from 'vitest';
import postgres, { type PostgresClient } from '../src/exports/runtime';
import postgresServerless, { type PostgresServerlessClient } from '../src/exports/serverless';
import postgresStatic, {
  contractFromJson,
  type PostgresStaticContext,
} from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract.d';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

test('contractFromJson returns the named contract type', () => {
  expectTypeOf(contract).toEqualTypeOf<Contract>();
});

test('contractFromJson takes only a SQL contract type', () => {
  // @ts-expect-error a type that is not a SQL contract
  contractFromJson<{ readonly target: 'postgres' }>(contractJson);
});

test('each client infers the contract type from the value', () => {
  expectTypeOf(postgres({ contract })).toEqualTypeOf<PostgresClient<Contract>>();
  expectTypeOf(postgresServerless({ contract })).toEqualTypeOf<
    PostgresServerlessClient<Contract>
  >();
  expectTypeOf(postgresStatic({ contract })).toEqualTypeOf<PostgresStaticContext<Contract>>();
  expectTypeOf(postgres({ contract }).orm.public.User).toHaveProperty('all');
});

test('no client takes contractJson', () => {
  // @ts-expect-error the contract is passed as a value
  postgres<Contract>({ contractJson });
  // @ts-expect-error the contract is passed as a value
  postgres({ contractJson });
  // @ts-expect-error the contract is passed as a value
  postgresServerless({ contractJson });
  // @ts-expect-error the contract is passed as a value
  postgresStatic({ contractJson });
});
