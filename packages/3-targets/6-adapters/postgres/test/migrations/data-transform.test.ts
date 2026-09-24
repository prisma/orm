import type { Contract } from '@internal/contract/types';
import { CliStructuredError } from '@internal/errors/control';
import { placeholder } from '@internal/errors/migration';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { AnyCodecDescriptor, Codec } from '@internal/framework-components/codec';
import { dataTypeId, voidParamsSchema } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ContractCodecRegistry, ProjectionExpr } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';
import { pgTable } from '@internal/target-postgres/contract-free';
import { dataTransform } from '@internal/target-postgres/data-transform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostgresCodecRegistryWithBuiltins } from '../../src/core/codec-lookup';
import { PostgresControlAdapter } from '../../src/core/control-adapter';
import { encodeControlQueryParams } from '../../src/core/control-codecs';

const CONTRACT_HASH = 'contract-abc';

const lowerToExecuteRequestMock = vi.fn();

function makeAdapter(): SqlControlAdapter<'postgres'> {
  return {
    lowerToExecuteRequest: lowerToExecuteRequestMock,
  } as unknown as SqlControlAdapter<'postgres'>;
}

function makeContract(storageHash: string = CONTRACT_HASH): Contract<SqlStorage> {
  return {
    storage: { storageHash, tables: {}, extensions: {}, schemas: [], types: {} },
    profile: { profileHash: 'profile', lanes: {} },
  } as unknown as Contract<SqlStorage>;
}

function makePlan(storageHash: string = CONTRACT_HASH): SqlQueryPlan {
  return {
    ast: { kind: 'synthetic-test-ast' } as unknown as SqlQueryPlan['ast'],
    params: [1, 'x'] as unknown as SqlQueryPlan['params'],
    meta: {
      target: 'postgres',
      storageHash,
      lane: 'sql',
    } as unknown as SqlQueryPlan['meta'],
  };
}

describe('dataTransform factory', () => {
  beforeEach(() => {
    lowerToExecuteRequestMock.mockReset();
  });

  it('lowers a single run with no check into execute-only steps', async () => {
    lowerToExecuteRequestMock.mockResolvedValue({
      sql: 'UPDATE users SET email = $1',
      params: ['n/a'],
    });
    const op = await dataTransform(
      makeContract(),
      'backfill-emails',
      { run: () => makePlan() },
      makeAdapter(),
    );
    expect(op).toMatchObject({
      id: 'data_migration.backfill-emails',
      label: 'Data transform: backfill-emails',
      operationClass: 'data',
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: 'Run backfill-emails',
          sql: 'UPDATE users SET email = $1',
          params: ['n/a'],
        },
      ],
      postcheck: [],
    });
  });

  it('supports a readonly array of run closures', async () => {
    let call = 0;
    lowerToExecuteRequestMock.mockImplementation(() =>
      Promise.resolve({ sql: `STMT_${call++}`, params: [1, 'x'] }),
    );
    const op = await dataTransform(
      makeContract(),
      'multi',
      { run: [() => makePlan(), () => makePlan()] },
      makeAdapter(),
    );
    expect(op.execute).toHaveLength(2);
    expect(op.execute).toEqual([
      { description: 'Run multi', sql: 'STMT_0', params: [1, 'x'] },
      { description: 'Run multi', sql: 'STMT_1', params: [1, 'x'] },
    ]);
  });

  it('wraps the check closure into precheck/postcheck with EXISTS / NOT EXISTS', async () => {
    lowerToExecuteRequestMock
      .mockResolvedValueOnce({
        sql: 'SELECT 1 FROM users WHERE email IS NULL',
        params: [],
      })
      .mockResolvedValue({
        sql: 'UPDATE users SET email = $1',
        params: ['n/a'],
      });
    const op = await dataTransform(
      makeContract(),
      'with-check',
      { check: () => makePlan(), run: () => makePlan() },
      makeAdapter(),
    );
    expect(op.precheck).toEqual([
      {
        description: 'Check with-check has work to do',
        sql: 'SELECT EXISTS (SELECT 1 FROM users WHERE email IS NULL) AS ok',
        params: [],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'Verify with-check resolved all violations',
        sql: 'SELECT NOT EXISTS (SELECT 1 FROM users WHERE email IS NULL) AS ok',
        params: [],
      },
    ]);
  });

  it('propagates MIGRATION.UNFILLED_PLACEHOLDER when a closure is a placeholder (never reaches the adapter)', async () => {
    lowerToExecuteRequestMock.mockResolvedValue({
      sql: 'X',
      params: [],
    });
    await expect(
      dataTransform(
        makeContract(),
        'not-yet-filled',
        { run: () => placeholder('not-yet-filled:run') },
        makeAdapter(),
      ),
    ).rejects.toMatchObject({
      code: 'MIGRATION.UNFILLED_PLACEHOLDER',
      meta: { slot: 'not-yet-filled:run' },
    });
  });

  it('throws MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH when a plan storageHash does not match the contract', async () => {
    lowerToExecuteRequestMock.mockResolvedValue({ sql: 'X', params: [] });
    try {
      await dataTransform(
        makeContract(),
        'mismatched',
        { run: () => makePlan('someone-elses-contract') },
        makeAdapter(),
      );
      expect.fail('expected dataTransform to throw');
    } catch (error) {
      expect(CliStructuredError.is(error)).toBe(true);
      const e = error as CliStructuredError;
      expect(e.code).toBe('MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH');
      expect(e.meta).toMatchObject({
        dataTransformName: 'mismatched',
        expected: CONTRACT_HASH,
        actual: 'someone-elses-contract',
      });
    }
  });

  it('accepts a Buildable by calling build() once', async () => {
    lowerToExecuteRequestMock.mockResolvedValue({ sql: 'SELECT 1', params: [1, 'x'] });
    const build = vi.fn(() => makePlan());
    const op = await dataTransform(
      makeContract(),
      'from-buildable',
      { run: () => ({ build }) },
      makeAdapter(),
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(op.execute).toHaveLength(1);
  });

  it('forwards the contract via LowererContext on every adapter.lowerToExecuteRequest call', async () => {
    const contract = makeContract();
    const adapter = makeAdapter();
    lowerToExecuteRequestMock.mockResolvedValue({ sql: 'X', params: [] });
    await dataTransform(contract, 'forwards-contract', { run: () => makePlan() }, adapter);
    expect(lowerToExecuteRequestMock).toHaveBeenCalled();
    for (const [, ctx] of lowerToExecuteRequestMock.mock.calls) {
      expect(ctx).toEqual({ contract });
    }
  });

  it('forwards invariantId onto the op when supplied', async () => {
    lowerToExecuteRequestMock.mockResolvedValue({ sql: 'X', params: [] });
    const op = await dataTransform(
      makeContract(),
      'backfill-emails',
      { invariantId: 'backfill-user-email', run: () => makePlan() },
      makeAdapter(),
    );
    expect(op.invariantId).toBe('backfill-user-email');
  });

  it('omits invariantId when not supplied', async () => {
    lowerToExecuteRequestMock.mockResolvedValue({ sql: 'X', params: [] });
    const op = await dataTransform(
      makeContract(),
      'no-invariant',
      { run: () => makePlan() },
      makeAdapter(),
    );
    expect(op).not.toHaveProperty('invariantId');
  });
});

const TEST_CODEC_ID = 'test/transform@1';

const transformingCodec: Codec = {
  id: TEST_CODEC_ID,
  encode: async (value: unknown) => `ENC:${String(value).toUpperCase()}`,
  decode: async (wire: unknown) => wire,
  encodeJson: (v) => v as never,
  decodeJson: (v) => v as never,
};

const transformingCodecDescriptor: AnyCodecDescriptor = {
  codecId: TEST_CODEC_ID,
  dataType: dataTypeId('demo/fixture'),
  traits: [],
  targetTypes: ['text'],
  paramsSchema: voidParamsSchema,
  isParameterized: false,
  factory: () => () => transformingCodec,
};
const transformingDescriptor = postgresCodec(transformingCodecDescriptor, {
  dataType: dataTypeId('demo/fixture'),
  nativeType: () => 'text',
  jsonProjection: (expression: ProjectionExpr) => expression,
});
const transformingCodecRegistry = createPostgresCodecRegistryWithBuiltins([transformingDescriptor]);

const testRegistry: ContractCodecRegistry = {
  forColumn: () => undefined,
  forCodecRef: (ref) => {
    if (ref.codecId === TEST_CODEC_ID) return transformingCodec;
    throw new Error(`unknown codec ${ref.codecId}`);
  },
};

const testTable = pgTable(
  { name: 'things' },
  {
    label: { codecId: TEST_CODEC_ID, nullable: false },
  },
);

const testAdapter = new PostgresControlAdapter(transformingCodecRegistry);

describe('dataTransform — codec-encoded params via lowerToExecuteRequest', () => {
  it('execute step params carry the codec-encoded wire value (not raw JS value)', async () => {
    const contract = makeContract();
    const ast = testTable.select(testTable.label).where(testTable.label.eq('plaintext')).build();
    const lowered = testAdapter.lower(ast, { contract });
    const params = await encodeControlQueryParams(lowered, ast, testRegistry);

    expect(params).not.toContain('plaintext');
    expect(params).toContain('ENC:PLAINTEXT');
  });
});
