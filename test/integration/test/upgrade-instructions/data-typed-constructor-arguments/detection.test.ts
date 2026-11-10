import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

function detectionOf(audience: 'app' | 'extension', id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

function detects(audience: 'app' | 'extension', id: string, content: string): boolean {
  return detectionOf(audience, id).some((pattern) => pattern.test(content));
}

describe('app detection of type-constructor arguments that are now refused', () => {
  it.each([
    'name VarChar("255")',
    'name VarChar(length: "255")',
    'price Numeric(10, "2")',
    'name VarChar(255.0)',
    'price Numeric(10.00, 2)',
    'created Timestamptz(3.0)',
    'name sql.String(2.0)',
    'created temporal.timestamp("3")',
    'created temporal.timestamp(3.0)',
  ])('detects %s', (line) => {
    expect(detects('app', 'type-constructor-arguments-are-values', line)).toBe(true);
  });

  it.each([
    'name VarChar(255)',
    'name VarChar(length: 255)',
    'price Numeric(10, 2)',
    'created temporal.timestamp(3)',
    'ratio Float @default(1.0)',
    'name String @default("255")',
    'name String @map("2.0")',
  ])('does not detect %s', (line) => {
    expect(detects('app', 'type-constructor-arguments-are-values', line)).toBe(false);
  });
});

describe('extension detection', () => {
  it.each([
    [
      'data-types-own-parameter-limits',
      "export const acmeMoney = mongoDataType('acme/money', {\n  bsonTypes: ['long'],\n});",
    ],
    ['data-types-own-parameter-limits', "const myType = dataType('my/type', { params });"],
    [
      'data-types-own-parameter-limits',
      "export const postgisGeometry = sqlDataType('postgis/geometry', { params, texts });",
    ],
    [
      'value-arguments-name-a-data-type',
      "args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }]",
    ],
    [
      'value-arguments-name-a-data-type',
      "const TEMPORAL_PRECISION_ARG = { name: 'precision', kind: 'number', optional: true, integer: true };",
    ],
    ['value-arguments-name-a-data-type', "args: [{ kind: 'number', integer: true }]"],
    ['value-arguments-name-a-data-type', "args: [{ kind: 'string', name: 'sql' }]"],
    [
      'value-arguments-name-a-data-type',
      "args: [{ name: 'length', integer: true, kind: 'number' }]",
    ],
    ['value-arguments-name-a-data-type', "args: [{ minimum: 1, kind: 'number' }]"],
    ['value-arguments-name-a-data-type', "args: [{ kind: 'number' }]"],
    [
      'psl-and-print-helpers-take-data-types',
      "import { assembleAuthoringDataTypes } from '@vendor/orm-framework/components/control';",
    ],
    [
      'psl-and-print-helpers-take-data-types',
      "import {\n  temporalCodecPresetWithPrecision,\n  temporalStringAuthoringPresets,\n} from '@vendor/orm-family-sql/family/control';",
    ],
    [
      'psl-and-print-helpers-take-data-types',
      "import { temporalCodecPresetWithPrecision } from '@vendor/family-sql/control';",
    ],
    ['psl-and-print-helpers-take-data-types', 'const args = parsePslPositionalArgs(call);'],
    [
      'psl-and-print-helpers-take-data-types',
      'const args = mapPslHelperArgs({ args: call.args, descriptors, helperLabel });',
    ],
    [
      'composed-helpers-take-no-data-type-lookup',
      'createComposedAuthoringHelpers({ family, target, codecLookup, dataTypeLookup })',
    ],
    [
      'composed-helpers-take-no-data-type-lookup',
      'createComposedAuthoringHelpers({\n  family,\n  dataTypeLookup: lookup,\n})',
    ],
    ['helper-codec-invariants', 'enforceDataTypeInvariants({ lookup, constructors })'],
    ['helper-codec-invariants', 'const input: DataTypeInvariantInput = build();'],
  ])('%s detects %s', (id, line) => {
    expect(detects('extension', id, line)).toBe(true);
  });

  it.each([
    [
      'psl-and-print-helpers-take-data-types',
      'const args = mapPslHelperArgs({ args: call.args, descriptors, helperLabel, dataTypes });',
    ],
    [
      'data-types-own-parameter-limits',
      "export const acmeMoney = mongoDataType('acme/money', {\n  bsonTypes: ['long'],\n  read: readMoney,\n});",
    ],
    [
      'data-types-own-parameter-limits',
      "export const postgisGeometry = sqlDataType('postgis/geometry', { params, texts, read: readGeometry });",
    ],
    [
      'value-arguments-name-a-data-type',
      "args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }]",
    ],
    ['value-arguments-name-a-data-type', "readonly written: { kind: 'number', text }"],
    [
      'value-arguments-name-a-data-type',
      "const literal = { name: 'x', written: { kind: 'number', text: '1' } };",
    ],
    [
      'psl-and-print-helpers-take-data-types',
      "import { assembleAuthoringDataTypes } from '@vendor/orm-framework/components/authoring';",
    ],
    [
      'psl-and-print-helpers-take-data-types',
      "import { temporalCodecPresetWithPrecision } from '@vendor/orm-family-sql/family/pack';",
    ],
    [
      'psl-and-print-helpers-take-data-types',
      "timestamp: temporalCodecPresetWithPrecision({ codecId, sizeType: 'pg/int4' }),",
    ],
    [
      'composed-helpers-take-no-data-type-lookup',
      'createComposedAuthoringHelpers({ family, target, codecLookup })',
    ],
    [
      'helper-codec-invariants',
      'enforceHelperCodecInvariants({ lookup, helpers, codecDescriptorFor })',
    ],
  ])('%s does not detect upgraded code: %s', (id, line) => {
    expect(detects('extension', id, line)).toBe(false);
  });
});
