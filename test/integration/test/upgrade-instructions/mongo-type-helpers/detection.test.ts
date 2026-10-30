import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = {
  app: 'upgrade-instructions/pending/mongo-type-helpers/app/instructions.md',
  extension: 'upgrade-instructions/pending/mongo-type-helpers/extension/instructions.md',
} as const;

const builderImport =
  "import { defineContract, field, model } from '@prisma/orm-mongo/contract-builder';\n";

describe.each(Object.entries(GUIDES))('the %s mongo-fields-take-a-type detection', (_, guide) => {
  const matches = (content: string) =>
    detectionPatterns(guide, 'mongo-fields-take-a-type').some((pattern) => pattern.test(content));

  it('matches a MongoDB contract source that calls a removed helper', () => {
    expect([
      matches(`${builderImport}const id = field.objectId();`),
      matches(`${builderImport}const v = field\n  .vector({ typeParams: { length: 3 } });`),
      matches(`${builderImport}const raw = helpers.field.scalar('mongo/bson@1');`),
      matches(
        "import { field } from '@prisma/orm-family-mongo/contract-ts/contract-builder';\nfield.int32();",
      ),
    ]).toEqual([true, true, true, true]);
  });

  it('does not match a rewritten source, a non-MongoDB source, or another helper', () => {
    expect([
      matches(`${builderImport}const id = field.scalar(type.ObjectId());`),
      matches(`${builderImport}const address = field.valueObject('Address');`),
      matches("import { z } from 'zod';\nconst name = field.string();"),
      matches(
        "import { field } from '@prisma/orm-postgres/contract-builder';\nfield.column(type.String());",
      ),
    ]).toEqual([false, false, false, false]);
  });
});
