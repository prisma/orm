import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = [
  'upgrade-instructions/pending/mongodb-scalar-convenience-types/app/instructions.md',
  'upgrade-instructions/pending/mongodb-scalar-convenience-types/extension/instructions.md',
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

  it('matches a call of the Int64 helper only', () => {
    expect({
      builder: ts('field.scalar(type.Int64())'),
      renamedParameter: ts('({ type: t }) => f.scalar(t.Int64())'),
      spaced: ts('field.scalar(type . Int64 ())'),
      multiLine: ts('field.scalar(\n  type\n    .Int64(),\n)'),
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
      bigIntExplicit: false,
      numberExplicit: false,
      convenience: false,
      driverLong: false,
      int32: false,
    });
  });
});
