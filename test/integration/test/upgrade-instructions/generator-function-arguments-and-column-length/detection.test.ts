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

describe('app detection', () => {
  it.each([
    [
      'prisma7-default-function-arguments-checked',
      'id String @default(uuid(5))',
      'id String @default(uuid(7))',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'id String @default(uuid(5))',
      'id String @default(uuid())',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'code String @default(cuid(1))',
      'code String @default(cuid(2))',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'code String @default(cuid(1))',
      'code String @default(cuid())',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'a String @default(nanoid(1))',
      'a String @default(nanoid(12))',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'a String @default(nanoid(1000))',
      'a String @default(nanoid(255))',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'a String @default(nanoid(256))',
      'a String @default(nanoid(2))',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'a String @default(nanoid(size: 8))',
      'a String @default(nanoid(8))',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'id String @default(uuid(4.0))',
      'id String @default(uuid(4))',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'a String @default(nanoid(8.5))',
      'a String @default(nanoid())',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'a String @default(nanoid(-1))',
      'a String @default(nanoid(21))',
    ],
    [
      'prisma7-default-function-arguments-checked',
      'a String @default(nanoid("8"))',
      'a String @default(nanoid(255))',
    ],
    [
      'prisma7-datetime-default-finer-than-column',
      'at DateTime @db.Timestamptz(0) @default("2024-01-02T03:04:05.5Z")',
      'at DateTime @db.Timestamptz(3) @default("2024-01-02T03:04:05.123Z")',
    ],
    [
      'prisma7-datetime-default-finer-than-column',
      'at DateTime @default("2024-01-02T03:04:05.12Z") @db.Timestamp(1)',
      'at DateTime @db.Timestamp(6) @default("2024-01-02T03:04:05.1234Z")',
    ],
    [
      'prisma7-lists-allow-null-elements',
      'model Post {\n  id   Int      @id\n  tags String[]\n}',
      'model Post {\n  id    Int    @id\n  posts Post[]\n}',
    ],
    [
      'prisma7-lists-allow-null-elements',
      'enum Role {\n  A\n}\n\nmodel User {\n  roles Role[]\n}',
      '// use prisma-8\n\nmodel Post {\n  tags String[]\n}',
    ],
    [
      'generator-function-argument-with-fraction',
      'a String @default(nanoid(8.0))',
      'a String @default(nanoid(8))',
    ],
    [
      'generator-function-argument-with-fraction',
      'id String @default(uuid(7.0))',
      'id String @default(uuid(7))',
    ],
    [
      'generator-function-argument-diagnostics',
      "expect(message).toBe('Expected one of: 4 | 7');",
      "expect(message).toBe('uuid: version must be 4 or 7, got 5');",
    ],
    [
      'generator-function-argument-diagnostics',
      "expect(message).toBe('Expected an integer between 2 and 255');",
      "expect(message).toBe('nanoid: size must be between 2 and 255, got 1');",
    ],
    [
      'generator-function-argument-diagnostics',
      `expect(message).toBe('Attribute "cuid" is missing required argument "version"');`,
      `expect(message).toBe('Generator function "cuid" is missing required argument "version"');`,
    ],
    [
      'generator-function-argument-diagnostics',
      '{"message": "Attribute \\"nanoid\\" received too many positional arguments"}',
      '{"message": "Attribute \\"map\\" received too many positional arguments"}',
    ],
    [
      'discriminator-must-be-text',
      `'Discriminator field "type" on model "Task" must be of type String, but is "Int"'`,
      `'Discriminator field "type" on model "Task" must be text, such as String, but is "Int"'`,
    ],
  ])('%s finds the old use and skips the new one', (id, before, after) => {
    expect({ before: detects('app', id, before), after: detects('app', id, after) }).toEqual({
      before: true,
      after: false,
    });
  });
});

describe('app detection of the discriminator message', () => {
  it('skips a Mongo project, whose message is unchanged', () => {
    expect(
      detects(
        'app',
        'discriminator-must-be-text',
        `const source = mongoContract(schemaPath);\nexpect(message).toContain('must be of type String');`,
      ),
    ).toBe(false);
  });
});

describe('extension detection', () => {
  it.each([
    [
      'sql-target-declares-integer-argument-generators',
      "export const myTargetMeta = { kind: 'target', familyId: 'sql', targetId: 'my' } as const;",
      "export const myTargetMeta = {\n  kind: 'target',\n  familyId: 'sql',\n  generatorFunctions: [...sqlIntegerArgumentGeneratorFunctions({ integer: myInt4.id })],\n} as const;",
    ],
    [
      'generator-signature-from-data-types',
      'for (const [name, entry] of stack.defaultFunctionRegistry) arms.push(funcCall(name, entry.signature as FuncCallSig));',
      'for (const [name, entry] of stack.defaultFunctionRegistry) arms.push(defaultFunctionCall(name, entry, dataTypes));',
    ],
    [
      'generator-signature-from-data-types',
      'const entry = stack.defaultFunctionRegistry.get(name);\nconst sig = entry?.signature;',
      'for (const fn of pack.generatorFunctions) arms.push(funcCall(fn.name, fn.signature as FuncCallSig));',
    ],
    [
      'build-contract-definition-takes-lookups',
      'const definition = buildContractDefinition({ family, target, createNamespace, models });',
      'return buildSqlContractFromDefinition(definition, codecLookup, dataTypeLookup);',
    ],
    [
      'arg-binding-spec-label',
      "interpretArgs(args, { name: 'rel', positional, named }, ctx, span, node);",
      'interpretAttribute(node, spec, ctx);',
    ],
    [
      'arg-binding-spec-label',
      'const spec: ArgBindingSpec<AttributeCtx> = { name, positional, named };',
      'const spec: AttributeSpec<Out, AttributeCtx> = fieldAttribute(name, options);',
    ],
    [
      'one-of-refuses-data-type-value',
      'type: oneOf(str(), dataTypeValue(pgInt4.id, dataTypes)),',
      'type: dataTypeValue(pgInt4.id, dataTypes),',
    ],
  ])('%s finds the old use and skips the new one', (id, before, after) => {
    expect({
      before: detects('extension', id, before),
      after: detects('extension', id, after),
    }).toEqual({ before: true, after: false });
  });

  it('skips a signature read in a file that names no default function registry', () => {
    expect(
      detects(
        'extension',
        'generator-signature-from-data-types',
        'const label = type.signature.documentation;',
      ),
    ).toBe(false);
  });
});
