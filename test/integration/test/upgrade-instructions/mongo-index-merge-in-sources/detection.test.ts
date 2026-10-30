import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const APP_NOTE = 'upgrade-instructions/pending/mongo-index-merge-in-sources/app/instructions.md';
const EXTENSION_NOTE =
  'upgrade-instructions/pending/mongo-index-merge-in-sources/extension/instructions.md';

const matcher = (path: string, id: string) => (content: string) =>
  detectionPatterns(path, id).some((pattern) => pattern.test(content));

const prisma6Model = (body: string) =>
  `model User {\n  id    String @id @default(auto()) @map("_id") @db.ObjectId\n${body}\n}\n`;

describe('the app mongo-prisma6-indexes-as-prisma6-reads-them detection', () => {
  const matches = matcher(APP_NOTE, 'mongo-prisma6-indexes-as-prisma6-reads-them');

  it('matches a Prisma 6 schema with an index, and not other schemas', () => {
    expect([
      matches(prisma6Model('  email String @unique')),
      matches(prisma6Model('  email String\n\n  @@index([email])')),
      matches(prisma6Model('  email String')),
      matches('model User {\n  id    ObjectId @id @map("_id")\n  email String @unique\n}\n'),
      matches('model User {\n  id    Int    @id\n  email String @unique\n}\n'),
    ]).toEqual([true, true, false, false, false]);
  });
});

describe('the extension mongo-build-refusal-index-duplicate-restored detection', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-build-refusal-index-duplicate-restored');

  it('matches code that reads builder refusals or calls the builder, and not defineContract', () => {
    expect([
      matches(
        "import type { BuildRefusal } from '@prisma/orm-family-mongo/contract-ts/contract-builder';",
      ),
      matches('const result = buildMongoContractFromDefinition(definition);'),
      matches('export const contract = defineContract({ models });'),
    ]).toEqual([true, true, false]);
  });
});
