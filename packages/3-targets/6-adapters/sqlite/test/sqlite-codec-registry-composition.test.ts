import type { JsonValue } from '@internal/contract/types';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  dataType,
  dataTypeId,
} from '@internal/framework-components/codec';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type { RuntimeExtensionDescriptor } from '@internal/framework-components/execution';
import {
  BinaryExpr,
  CodecJsonValueProjection,
  ColumnRef,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ParamRef,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
  SQL_CHAR_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
  TableSource,
} from '@internal/sql-relational-core/ast';
import {
  type AnySqliteCodecDescriptor,
  sqliteCodec,
} from '@internal/target-sqlite/codec-descriptor';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
} from '@internal/target-sqlite/codec-ids';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import sqliteTargetControlDescriptor from '@internal/target-sqlite/control';
import sqliteRuntimeTargetDescriptor from '@internal/target-sqlite/runtime';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createSqliteAdapter } from '../src/core/adapter';
import {
  assembleSqliteCodecRegistry,
  createSqliteBuiltinCodecLookup,
  createSqliteCodecRegistryWithBuiltins,
} from '../src/core/codec-lookup';
import { sqliteAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import type { SqliteContract } from '../src/core/types';
import sqliteAdapterControlDescriptor from '../src/exports/control';
import sqliteRuntimeAdapterDescriptor from '../src/exports/runtime';

/** The data types the fixture codecs of one contribution represent, so assembly finds them. */
/** A fixture codec's data type: its own id without the version. */
const fixtureTypeId = (codecId: string) => dataTypeId(codecId.split('@')[0] ?? codecId);

const fixtureDataTypes = (descriptors: readonly { readonly dataType?: string }[]) =>
  [...new Set(descriptors.map((descriptor) => descriptor.dataType))]
    .filter((id): id is string => id !== undefined)
    .map((id) => dataType(id, {}));

class TestCodec extends CodecImpl<string, readonly ['equality'], string, string> {
  constructor(
    descriptor: AnyCodecDescriptor,
    private readonly transform: (value: string) => string,
  ) {
    super(descriptor);
  }

  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return this.transform(value);
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }

  encodeJson(value: string): JsonValue {
    return value;
  }

  decodeJson(json: JsonValue): string {
    if (typeof json !== 'string') {
      throw new TypeError('Expected string JSON');
    }
    return json;
  }
}

class TestGenericDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = undefined;

  constructor(
    override readonly codecId: string,
    private readonly onMaterialize: () => void = () => {},
    private readonly transform: (value: string) => string = (value) => value,
  ) {
    super();
  }

  override factory(): (ctx: CodecInstanceContext) => TestCodec {
    this.onMaterialize();
    return () => new TestCodec(this, this.transform);
  }
}

function sqliteDescriptor(options: {
  readonly codecId: string;
  readonly onMaterialize?: () => void;
  readonly transform?: (value: string) => string;
  readonly onProjection?: () => void;
}): AnySqliteCodecDescriptor {
  const descriptor = new TestGenericDescriptor(
    options.codecId,
    options.onMaterialize,
    options.transform,
  );
  return sqliteCodec(descriptor, {
    dataType: fixtureTypeId(options.codecId),
    jsonProjection(expression: ProjectionExpr): ProjectionExpr {
      options.onProjection?.();
      return expression;
    },
  });
}

function runtimeExtension(
  id: string,
  descriptors: readonly AnyCodecDescriptor[],
): RuntimeExtensionDescriptor<'sql', 'sqlite'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'sqlite',
    dataTypes: fixtureDataTypes(descriptors),
    types: { codecTypes: { codecDescriptors: descriptors } },
    create() {
      return { familyId: 'sql', targetId: 'sqlite' };
    },
  };
}

function controlExtension(
  id: string,
  descriptors: readonly AnyCodecDescriptor[],
): ControlExtensionDescriptor<'sql', 'sqlite'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'sqlite',
    dataTypes: fixtureDataTypes(descriptors),
    types: { codecTypes: { codecDescriptors: descriptors } },
    create() {
      return { familyId: 'sql', targetId: 'sqlite' };
    },
  };
}

function createComposedRuntimeAdapter(
  descriptors: readonly AnyCodecDescriptor[],
  targetDescriptors: readonly AnyCodecDescriptor[] = [],
) {
  return sqliteRuntimeAdapterDescriptor.create({
    target: {
      ...sqliteRuntimeTargetDescriptor,
      types: { codecTypes: { codecDescriptors: targetDescriptors } },
    },
    adapter: sqliteRuntimeAdapterDescriptor,
    driver: undefined,
    extensions: [runtimeExtension('runtime-codecs', descriptors)],
  });
}

function createComposedControlAdapter(
  descriptors: readonly AnyCodecDescriptor[],
  targetDescriptors: readonly AnyCodecDescriptor[] = [],
) {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: {
      ...sqliteTargetControlDescriptor,
      types: { codecTypes: { codecDescriptors: targetDescriptors } },
    },
    adapter: sqliteAdapterControlDescriptor,
    extensions: [controlExtension('control-codecs', descriptors)],
  });
  return sqliteAdapterControlDescriptor.create(stack);
}

const contract = new SqlContractSerializer().deserializeContract({
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: 'sha256:sqlite-codec-registry-composition',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'sha256:sqlite-codec-registry-composition',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            records: {
              columns: {
                id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
                value: { codecId: 'app/transform@1', nativeType: 'text', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as SqliteContract;

function selectWithParam(codecId: string, value: unknown) {
  return SelectAst.from(TableSource.named('records'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('records', 'id'))])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('records', 'value'),
        ParamRef.of(value, { name: 'value', codec: { codecId } }),
      ),
    );
}

describe('SQLite adapter codec registry composition', () => {
  it('assembles the same immutable ordered registry for runtime and control contributions', () => {
    const targetDescriptor = sqliteDescriptor({ codecId: 'app/target@1' });
    const extensionDescriptors = [
      sqliteDescriptor({ codecId: 'app/first@1' }),
      sqliteDescriptor({ codecId: 'app/second@1' }),
    ];
    const runtimeTarget = {
      ...sqliteRuntimeTargetDescriptor,
      types: { codecTypes: { codecDescriptors: [targetDescriptor] } },
    };
    const controlTarget = {
      ...sqliteTargetControlDescriptor,
      types: { codecTypes: { codecDescriptors: [targetDescriptor] } },
    };
    const runtimeRegistry = assembleSqliteCodecRegistry(
      runtimeTarget,
      extensionDescriptors.map((descriptor, index) =>
        runtimeExtension(`runtime-${index}`, [descriptor]),
      ),
    );
    const controlRegistry = assembleSqliteCodecRegistry(
      controlTarget,
      extensionDescriptors.map((descriptor, index) =>
        controlExtension(`control-${index}`, [descriptor]),
      ),
    );
    const builtinIds = Array.from(
      sqliteCodecDescriptorRegistry.values(),
      (descriptor) => descriptor.codecId,
    );
    const expectedIds = ['app/target@1', ...builtinIds, 'app/first@1', 'app/second@1'];
    const filteredMetadataIds = sqliteAdapterDescriptorMeta.types.codecTypes.codecDescriptors.map(
      (descriptor) => descriptor.codecId,
    );

    expect(filteredMetadataIds).not.toContain(SQL_CHAR_CODEC_ID);
    expect(filteredMetadataIds).not.toContain(SQL_VARCHAR_CODEC_ID);
    expect(Object.isFrozen(runtimeRegistry)).toBe(true);
    expect(Object.isFrozen(controlRegistry)).toBe(true);
    expect(Array.from(runtimeRegistry.values(), (descriptor) => descriptor.codecId)).toEqual(
      expectedIds,
    );
    expect(Array.from(controlRegistry.values(), (descriptor) => descriptor.codecId)).toEqual(
      expectedIds,
    );
    expect(runtimeRegistry.get(SQL_CHAR_CODEC_ID)).toBeDefined();
    expect(controlRegistry.get(SQL_VARCHAR_CODEC_ID)).toBeDefined();
  });

  it('keeps bare construction built-ins-only and appends direct target descriptors coherently', () => {
    let materializations = 0;
    const descriptor = sqliteDescriptor({
      codecId: 'app/direct@1',
      onMaterialize: () => {
        materializations += 1;
      },
    });
    const builtinRegistry = createSqliteBuiltinCodecLookup();
    const directRegistry = createSqliteCodecRegistryWithBuiltins([descriptor]);

    expect(Array.from(builtinRegistry.values(), (item) => item.codecId)).toEqual(
      Array.from(sqliteCodecDescriptorRegistry.values(), (item) => item.codecId),
    );
    expect(builtinRegistry.descriptorFor(descriptor.codecId)).toBeUndefined();
    expect(Array.from(directRegistry.values()).at(-1)).toBe(descriptor);
    expect(directRegistry.get(descriptor.codecId)?.id).toBe(descriptor.codecId);
    expect(materializations).toBe(1);

    createSqliteAdapter();
    expect(materializations).toBe(1);
    createSqliteAdapter({ codecDescriptors: [descriptor] });
    expect(materializations).toBe(2);
  });

  it('makes runtime and control adapter factories consume stack descriptor contributions', () => {
    let runtimeMaterializations = 0;
    let controlMaterializations = 0;
    const runtimeDescriptor = sqliteDescriptor({
      codecId: 'app/runtime@1',
      onMaterialize: () => {
        runtimeMaterializations += 1;
      },
    });
    const controlDescriptor = sqliteDescriptor({
      codecId: 'app/control@1',
      onMaterialize: () => {
        controlMaterializations += 1;
      },
    });

    createComposedRuntimeAdapter([runtimeDescriptor]);
    expect(runtimeMaterializations).toBe(1);

    const stack = createControlStack({
      family: sqlFamilyDescriptor,
      target: sqliteTargetControlDescriptor,
      adapter: sqliteAdapterControlDescriptor,
      extensions: [controlExtension('control-materialization', [controlDescriptor])],
    });
    controlMaterializations = 0;
    sqliteAdapterControlDescriptor.create(stack);
    expect(controlMaterializations).toBe(1);
  });

  it('encodes extension parameters through the stack-composed control registry', async () => {
    const descriptor = sqliteDescriptor({
      codecId: 'app/transform@1',
      transform: (value) => `encoded:${value}`,
    });
    const adapter = createComposedControlAdapter([descriptor]);

    await expect(
      adapter.lowerToExecuteRequest(selectWithParam(descriptor.codecId, 'value'), { contract }),
    ).resolves.toEqual({
      sql: 'SELECT "records"."id" AS "id" FROM "records" WHERE "records"."value" = ?',
      params: ['encoded:value'],
    });
  });

  it('rejects raw, wrong-target, and malformed descriptors during both adapter compositions', () => {
    const raw = new TestGenericDescriptor('app/raw@1');
    const wrongTarget = {
      ...raw,
      codecId: 'app/wrong-target@1',
      traits: raw.traits,
      targetTypes: raw.targetTypes,
      paramsSchema: raw.paramsSchema,
      isParameterized: raw.isParameterized,
      factory: raw.factory.bind(raw),
      descriptorKind: 'postgres-codec',
      nativeTypeFor: () => 'text',
      projectJson: (expression: ProjectionExpr) => expression,
    } as const;
    const malformed = {
      ...wrongTarget,
      codecId: 'app/malformed@1',
      descriptorKind: 'sqlite-codec',
      projectJson: undefined,
    } as const;

    for (const descriptor of [raw, wrongTarget, malformed]) {
      expect(() => createComposedRuntimeAdapter([descriptor])).toThrow(
        /not a valid SQLite codec descriptor/,
      );
      expect(() => createComposedControlAdapter([descriptor])).toThrow(
        /not a valid SQLite codec descriptor/,
      );
    }
  });

  it('rejects duplicate ids against the complete built-in registry before lowering', () => {
    const duplicate = sqliteDescriptor({ codecId: SQL_CHAR_CODEC_ID });

    expect(() => createComposedRuntimeAdapter([duplicate])).toThrow(
      /Duplicate SQLite codec descriptor id.*sql\/char@1/,
    );
    expect(() => createComposedControlAdapter([duplicate])).toThrow(
      /Duplicate SQLite codec descriptor id.*sql\/char@1/,
    );
  });

  it('asks a composed descriptor how to project every JSON entry it owns', () => {
    let projectionCalls = 0;
    const descriptor = sqliteDescriptor({
      codecId: 'app/json-hook@1',
      onProjection: () => {
        projectionCalls += 1;
      },
    });
    const runtimeAdapter = createComposedRuntimeAdapter([descriptor]);
    const controlAdapter = createComposedControlAdapter([descriptor]);
    const projection = new CodecJsonValueProjection(ColumnRef.of('records', 'value'), {
      codecId: descriptor.codecId,
    });
    const ast = SelectAst.from(TableSource.named('records')).withProjection([
      ProjectionItem.of(
        'object',
        JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', projection)]),
      ),
      ProjectionItem.of('array', JsonArrayAggExpr.of(projection)),
    ]);

    const runtime = runtimeAdapter.lower(ast, { contract });
    const control = controlAdapter.lower(ast, { contract });

    // This descriptor's projection is the identity, so the SQL is unchanged —
    // which is the point: a codec whose canonical JSON is its stored form
    // renders as itself, and the renderer still had to ask to find that out.
    // The call count is what says it asked, once per entry, on both paths.
    expect(runtime.sql).toBe(
      `SELECT json_object('value', "records"."value") AS "object", json_group_array("records"."value") AS "array" FROM "records"`,
    );
    expect(control).toEqual(runtime);
    expect(projectionCalls).toBe(4);
  });

  it('preserves built-in BLOB, bigint, and structured JSON representations', () => {
    const registry = createSqliteBuiltinCodecLookup();
    const blob = registry.get(SQLITE_BLOB_CODEC_ID);
    const bigint = registry.get(SQLITE_BIGINT_CODEC_ID);
    const json = registry.get(SQLITE_JSON_CODEC_ID);
    const document = { nested: ['value', 1, true, null] };

    expect(blob?.encodeJson(new Uint8Array([0x0a, 0xbc]))).toBe('0ABC');
    expect(bigint?.encodeJson(42n)).toBe('42');
    expect(bigint?.encodeJson(9007199254740993n)).toBe('9007199254740993');
    expect(json?.encodeJson(document)).toEqual(document);
  });
});
