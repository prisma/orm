import type { ContractConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { refuseOtherTargetOnLoad, typescriptContract } from '../src/config-types';
import { stubContext as context } from './contract-source-context';

const forPostgres = {
  target: {
    kind: 'target',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    defaultNamespaceId: 'public',
  } satisfies TargetPackRef<'sql', 'postgres'>,
  contractBuilderModule: '@prisma/orm-postgres/contract-builder',
};

const contractFor = (target: string) =>
  ({ targetFamily: 'sql', target, storage: { namespaces: {} } }) as Contract;

const pslConfigOf = (contract: Contract): ContractConfig => ({
  source: {
    format: 'psl',
    inputs: ['./prisma/schema.prisma'],
    parserOptions: { grammar: 'prisma-7' },
    load: async () => ok(contract),
  },
  output: './prisma/contract.json',
});

const refusalOf = async (config: ContractConfig) =>
  refuseOtherTargetOnLoad(config, forPostgres)
    .source.load(context)
    .then(
      () => undefined,
      (error) => ({
        code: Object(error).code,
        message: Object(error).message,
        why: Object(error).why,
        fix: Object(error).fix,
        meta: Object(error).meta,
      }),
    );

describe('refuseOtherTargetOnLoad', () => {
  it('refuses a ready TypeScript contract built for another target, which names no file', async () => {
    expect(await refusalOf(typescriptContract(contractFor('mysql')))).toEqual({
      code: 'CONTRACT.TARGET_MISMATCH',
      message:
        'The TypeScript contract passed to defineConfig was built for target "mysql", but this defineConfig is for target "postgres".',
      why: "The contract carries another target's id and capabilities, so it was built or emitted for that target.",
      fix: 'Pass a contract built for postgres, such as one made with the defineContract from @prisma/orm-postgres/contract-builder.',
      meta: { expected: 'postgres', actual: 'mysql' },
    });
  });

  it('refuses a ready Prisma schema contract built for another target, naming its first input', async () => {
    expect(await refusalOf(pslConfigOf(contractFor('sqlite')))).toEqual({
      code: 'CONTRACT.TARGET_MISMATCH',
      message:
        'The contract "./prisma/schema.prisma" was built for target "sqlite", but this defineConfig is for target "postgres".',
      why: "Its contract config was made with another target's components, so the contract carries that target's id and capabilities.",
      fix: "Make the contract config with postgres's components, or pass the schema's path as `contract`.",
      meta: { contract: './prisma/schema.prisma', expected: 'postgres', actual: 'sqlite' },
    });
  });

  it('loads a contract built for the target unchanged, and keeps the rest of the config', async () => {
    const contract = contractFor('postgres');
    const config = refuseOtherTargetOnLoad(pslConfigOf(contract), forPostgres);
    const result = await config.source.load(context);
    expect({
      loaded: result.ok ? result.value : result.failure,
      format: config.source.format,
      inputs: config.source.inputs,
      parserOptions: config.source.format === 'psl' ? config.source.parserOptions : undefined,
      output: config.output,
    }).toEqual({
      loaded: contract,
      format: 'psl',
      inputs: ['./prisma/schema.prisma'],
      parserOptions: { grammar: 'prisma-7' },
      output: './prisma/contract.json',
    });
  });

  it('passes a result that is not a well-formed success through unchanged, for the CLI to report', async () => {
    const malformed = [undefined, null, { ok: true }, { ok: true, value: null }, { ok: 'yes' }];
    const passedThrough = await Promise.all(
      malformed.map((result) =>
        refuseOtherTargetOnLoad(
          { source: { format: 'typescript', load: async () => result as never } },
          forPostgres,
        ).source.load(context),
      ),
    );
    expect(passedThrough).toEqual(malformed);
  });

  it('passes a failed load through unchanged', async () => {
    const failed = notOk({ summary: 'schema did not parse', diagnostics: [] });
    const config = refuseOtherTargetOnLoad(
      { source: { format: 'psl', load: async () => failed } },
      forPostgres,
    );
    expect(await config.source.load(context)).toBe(failed);
  });

  it('calls the original load as a method of its source', async () => {
    const source = {
      format: 'typescript' as const,
      contract: contractFor('postgres'),
      async load() {
        return ok(this.contract);
      },
    };
    const result = await refuseOtherTargetOnLoad({ source }, forPostgres).source.load(context);
    expect(result.ok ? result.value : result.failure).toBe(source.contract);
  });
});
