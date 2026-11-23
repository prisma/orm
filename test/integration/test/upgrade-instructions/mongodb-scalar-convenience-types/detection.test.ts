import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = [
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
];

describe.each(GUIDES)('the renamed MongoDB Int64 detections in %s', (guidePath) => {
  const matches = (id: string, content: string) =>
    detectionPatterns(guidePath, id).some((pattern) => pattern.test(content));
  const psl = (content: string) => matches('psl-renamed-mongo-int64', content);
  const ts = (content: string) => matches('ts-removed-mongo-int64-helper', content);

  it('matches the type Int64 in a schema only', () => {
    expect({
      field: psl('model A {\n  id ObjectId @id @map("_id")\n  views Int64\n}'),
      optional: psl('model A {\n  views Int64?\n}'),
      list: psl('model A {\n  views Int64[]\n}'),
      parentheses: psl('model A {\n  views Int64 ()\n}'),
      alias: psl('types {\n  Count = Int64\n}'),
      member: psl('type Point {\n  x Int64\n}'),
      bigIntExplicit: psl('model A {\n  views Int64BigInt\n}'),
      numberExplicit: psl('model A {\n  views Int64Number\n}'),
      convenience: psl('model A {\n  views BigInt\n}'),
      codecId: psl('enum Big {\n  @@type("mongo/int64@1")\n  A = 1\n}'),
      int32: psl('model A {\n  views Int32\n}'),
    }).toEqual({
      field: true,
      optional: true,
      list: true,
      parentheses: true,
      alias: true,
      member: true,
      bigIntExplicit: false,
      numberExplicit: false,
      convenience: false,
      codecId: false,
      int32: false,
    });
  });

  it('matches a read of the Int64 helper only', () => {
    expect({
      builder: ts('field.scalar(type.Int64())'),
      renamedParameter: ts('({ type: t }) => f.scalar(t.Int64())'),
      spaced: ts('field.scalar(type . Int64 ())'),
      multiLine: ts('field.scalar(\n  type\n    .Int64(),\n)'),
      readWithoutCall: ts('const long = type.Int64;'),
      destructured: ts('const { Int64 } = type;\nfield.scalar(Int64())'),
      destructuredAmongOthers: ts('const {\n  ObjectId,\n  Int64: Long,\n} = t;'),
      destructuredExplicit: ts('const { Int64BigInt, Int64Number } = type;'),
      objectLiteral: ts('const widths = { Int64: 8 };'),
      bigIntExplicit: ts('field.scalar(type.Int64BigInt())'),
      numberExplicit: ts('field.scalar(type.Int64Number())'),
      convenience: ts("field.scalar(type.BigInt({ as: 'number' }))"),
      driverLong: ts('Long.fromNumber(1)'),
      int32: ts('field.scalar(type.Int32())'),
    }).toEqual({
      builder: true,
      renamedParameter: true,
      spaced: true,
      multiLine: true,
      readWithoutCall: true,
      destructured: true,
      destructuredAmongOthers: true,
      destructuredExplicit: false,
      objectLiteral: false,
      bigIntExplicit: false,
      numberExplicit: false,
      convenience: false,
      driverLong: false,
      int32: false,
    });
  });

  it('also matches Int64 in a schema comment and an Int64 call of another library, which need no change', () => {
    expect({
      schemaComment: psl('model A {\n  views BigInt // was Int64\n}'),
      otherLibraryCall: ts('const column = new arrow.Int64();'),
    }).toEqual({ schemaComment: true, otherLibraryCall: true });
  });
});

describe('the optional MongoDB convenience name detection in the app guide', () => {
  const optional = (content: string) =>
    detectionPatterns(
      'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
      'psl-optional-mongo-convenience-names',
    ).some((pattern) => pattern.test(content));
  const mongoModel = (type: string) =>
    `model A {\n  id ObjectId @id @map("_id")\n  value ${type}\n}`;

  it('matches Int32, Double and Bool in a MongoDB schema only', () => {
    expect({
      int32: optional(mongoModel('Int32')),
      double: optional(mongoModel('Double[]?')),
      bool: optional(mongoModel('Bool')),
      alias: optional('types {\n  Count = Int32\n}\n\nmodel A {\n  id ObjectId @id\n}'),
      convenience: optional(mongoModel('Int')),
      longerName: optional(mongoModel('DoubleValue')),
      codecId: optional(
        'enum Big {\n  @@type("mongo/int32@1")\n  A = 1\n}\nmodel A {\n  id ObjectId @id\n}',
      ),
      noObjectId: optional('model A {\n  id Int4 @id\n  flag Bool\n}'),
    }).toEqual({
      int32: true,
      double: true,
      bool: true,
      alias: true,
      convenience: false,
      longerName: false,
      codecId: false,
      noObjectId: false,
    });
  });
});
