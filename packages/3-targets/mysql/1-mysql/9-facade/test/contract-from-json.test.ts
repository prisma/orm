import { describe, expect, it } from 'vitest';
import mysql from '../src/exports/runtime';
import mysqlStatic, { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract.d';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

describe('a MySQL contract and its format version', () => {
  it('reads a contract file in a format version it knows', () => {
    expect(contractFromJson<Contract>(structuredClone(fixtureContractJson)).target).toBe('mysql');
  });

  it('refuses a contract written by a newer release, passed to contractFromJson or a client', () => {
    const newer = { ...fixtureContractJson, formatVersion: 2 };
    const refusal = expect.objectContaining({ code: 'CONTRACT.FORMAT_VERSION_NEWER' });
    expect(() => contractFromJson(newer)).toThrow(refusal);
    expect(() => mysqlStatic({ contract: newer as unknown as Contract })).toThrow(refusal);
  });

  it('reads a contract a release candidate wrote', () => {
    const { formatVersion: _, ...rest } = fixtureContractJson;
    expect(contractFromJson<Contract>({ schemaVersion: '1', ...rest })).toEqual(
      contractFromJson<Contract>(structuredClone(fixtureContractJson)),
    );
  });

  it('refuses a stored contract with no format version passed straight to a client', () => {
    const { formatVersion: _, ...withoutVersion } = fixtureContractJson;
    const refusal = expect.objectContaining({ code: 'CONTRACT.FORMAT_VERSION_MISSING' });
    expect(() => mysqlStatic({ contract: withoutVersion as unknown as Contract })).toThrow(refusal);
    expect(() => mysql({ contract: withoutVersion as unknown as Contract })).toThrow(refusal);
  });
});
