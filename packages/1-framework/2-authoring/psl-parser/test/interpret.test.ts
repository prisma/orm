import type {
  ContractSourceDiagnostics,
  ContractSourceProvider,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { hasPslInterpreter, type PslInterpretCapable, withSeedDiagnostics } from '../src/interpret';

const load: ContractSourceProvider['load'] = async () => ok({} as never);

describe('hasPslInterpreter', () => {
  it('accepts a psl provider carrying an interpret function', () => {
    const provider: PslInterpretCapable = {
      format: 'psl',
      load,
      interpret: () => ok({} as never),
    };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(true);
  });

  it('exposes interpret on the narrowed source', () => {
    const provider: PslInterpretCapable = {
      format: 'psl',
      load,
      interpret: () => ok({} as never),
    };
    const source: ContractSourceProvider = provider;

    if (!hasPslInterpreter(source)) {
      throw new Error('expected guard to accept the provider');
    }
    expect(source.interpret).toBe(provider.interpret);
  });

  it('rejects a typescript provider even when it carries an interpret function', () => {
    const provider = { format: 'typescript' as const, load, interpret: () => [] };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(false);
  });

  it('rejects a typescript provider carrying interpret', () => {
    const provider = { format: 'typescript' as const, load, interpret: () => [] };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(false);
  });

  it('rejects a psl provider without an interpret method', () => {
    const source: ContractSourceProvider = { format: 'psl', load };

    expect(hasPslInterpreter(source)).toBe(false);
  });

  it('rejects a psl provider whose interpret is not a function', () => {
    const provider = { format: 'psl' as const, load, interpret: 'not-a-function' };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(false);
  });
});

describe('withSeedDiagnostics', () => {
  const seeds = [
    { code: 'PSL_SEED_ONE', message: 'first seed', sourceId: './schema.prisma' },
    { code: 'PSL_SEED_TWO', message: 'second seed', sourceId: './schema.prisma' },
  ];
  const interpreterFailure: Result<Contract, ContractSourceDiagnostics> = notOk({
    summary: 'PSL to SQL contract interpretation failed',
    diagnostics: [
      { code: 'PSL_UNSUPPORTED_FIELD_TYPE', message: 'unknown type', sourceId: './schema.prisma' },
    ],
    meta: { schemaPath: './schema.prisma' },
  });

  it('returns the result unchanged when seeds are empty', () => {
    const okResult: Result<Contract, ContractSourceDiagnostics> = ok({} as never);

    expect(withSeedDiagnostics(okResult, [])).toBe(okResult);
    expect(withSeedDiagnostics(interpreterFailure, [])).toBe(interpreterFailure);
  });

  it('prepends seeds to an existing failure, keeps meta, and authors a count-bearing headline', () => {
    const merged = withSeedDiagnostics(interpreterFailure, seeds);

    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.failure.diagnostics).toEqual([
      seeds[0],
      seeds[1],
      { code: 'PSL_UNSUPPORTED_FIELD_TYPE', message: 'unknown type', sourceId: './schema.prisma' },
    ]);
    expect(merged.failure.summary).toBe('Schema has 3 errors');
    expect(merged.failure.meta).toEqual({ schemaPath: './schema.prisma' });
  });

  it('fails an ok result when seeds exist, discarding the contract', () => {
    const single = seeds.slice(0, 1);
    const failed = withSeedDiagnostics(ok({} as never), single);

    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.failure.diagnostics).toEqual(single);
    expect(failed.failure.summary).toBe('Schema has 1 error');
    expect(failed.failure.meta).toBeUndefined();
  });
});
