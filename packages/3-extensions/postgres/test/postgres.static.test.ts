import { buildNamespacedEnums, type NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import postgresStatic, { type PostgresStaticContext } from '../src/static/postgres-static';

const contract = createContract<SqlStorage>();

describe('postgresStatic({ contractJson })', () => {
  it('returns context, contract, enums, sql, and raw', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(result.context).toBeDefined();
    expect(result.contract).toBeDefined();
    expect(result.enums).toBeDefined();
    expect(result.sql).toBeDefined();
    expect(result.raw).toBeDefined();
  });

  it('context carries the contract (merged capabilities view)', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(result.context.contract).toBeDefined();
    expect(result.context.contract.target).toBe(contract.target);
  });

  it('context carries the codec registry (standard codecs present)', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(result.context.contractCodecs).toBeDefined();
  });

  it('contract matches the deserialized contractJson', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(result.contract.target).toBe(contract.target);
    expect(result.contract.targetFamily).toBe(contract.targetFamily);
    expect(result.contract.domain).toEqual(contract.domain);
    expect(result.contract.profileHash).toBe(contract.profileHash);
  });

  it('sql is a function (builder is present)', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(typeof result.sql).toBe('object');
  });

  it('raw is the lane holding the statement tag', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(typeof result.raw).toBe('object');
    expect(typeof result.raw.sql).toBe('function');
  });

  it('enums matches what buildNamespacedEnums produces', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    const allNamespaced = buildNamespacedEnums(contract.domain, (codecId) =>
      result.context.contractCodecs.forCodecRef({ codecId }),
    ) as NamespacedEnums<Contract<SqlStorage>>;

    expect(result.enums).toMatchObject(allNamespaced);
  });

  it('PostgresStaticContext type exposes context, contract, enums, sql, raw', () => {
    const result: PostgresStaticContext<typeof contract> = postgresStatic<typeof contract>({
      contractJson: contract,
    });
    expect(result).toBeDefined();
  });
});
