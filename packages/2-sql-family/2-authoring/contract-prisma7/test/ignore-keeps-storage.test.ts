import { describe, expect, it } from 'vitest';
import { fixtureSchemaText, interpretSchemaText } from './support';

const storageOf = (text: string) => interpretSchemaText(text).storage;

function withoutIgnoreOn(text: string, fieldNames: readonly string[]): string {
  return fieldNames.reduce((schema, fieldName) => {
    const line = new RegExp(`^(\\s+${fieldName}\\s.*?)\\s*@ignore(.*)$`, 'm');
    expect(schema).toMatch(line);
    return schema.replace(line, '$1$2');
  }, text);
}

function withoutModelIgnore(text: string, modelName?: string): string {
  const line = new RegExp(`(^model ${modelName ?? '\\w+'} \\{[^}]*?)\\n\\s*@@ignore`, 'm');
  expect(text).toMatch(line);
  return text.replace(line, '$1');
}

describe('@ignore leaves storage as it is', () => {
  it('on fields a unique and an index cover', () => {
    const ignored = fixtureSchemaText('ignored-field-in-index');
    expect(storageOf(ignored)).toStrictEqual(storageOf(withoutIgnoreOn(ignored, ['b', 'c'])));
  });

  it('on a relation field', () => {
    const ignored = fixtureSchemaText('ignored-relation-field');
    expect(storageOf(ignored)).toStrictEqual(
      storageOf(withoutIgnoreOn(ignored, ['posts', 'author'])),
    );
  });

  it('on a relation field only, with its back-relation kept', () => {
    const ignored = fixtureSchemaText('ignored-relation-field');
    expect(storageOf(withoutIgnoreOn(ignored, ['posts']))).toStrictEqual(
      storageOf(withoutIgnoreOn(ignored, ['posts', 'author'])),
    );
  });

  // `ref` and `seenAt` (optional and generated), `day` (@updatedAt on @db.Date) and `stamp` (@updatedAt with @default) stay ignored on both sides: Prisma 8 refuses each of them unignored.
  it('on fields with column defaults, generators and @updatedAt', () => {
    const ignored = fixtureSchemaText('ignored-field-defaults');
    expect(storageOf(ignored)).toStrictEqual(
      storageOf(withoutIgnoreOn(ignored, ['status', 'createdAt', 'token', 'touchedAt', 'labels'])),
    );
  });

  it('on a model and the relation fields that point to it', () => {
    const ignored = fixtureSchemaText('ignore');
    expect(storageOf(ignored)).toStrictEqual(
      storageOf(withoutIgnoreOn(withoutModelIgnore(ignored), ['legacy', 'things'])),
    );
  });

  it('on a model, a relation field, and its back-relation', () => {
    const ignored = fixtureSchemaText('relations-ignored');
    expect(storageOf(ignored)).toStrictEqual(
      storageOf(
        withoutIgnoreOn(withoutModelIgnore(ignored), [
          'legacyOwned',
          'things',
          'legacyOwnerId',
          'legacyOwner',
        ]),
      ),
    );
  });

  it('on relation fields, including one side of an implicit many-to-many relation', () => {
    const ignored = fixtureSchemaText('ignored-relation-back-relations');
    expect(storageOf(ignored)).toStrictEqual(
      storageOf(withoutIgnoreOn(ignored, ['manager', 'author', 'user', 'users'])),
    );
  });

  it('on a model on one side of an implicit many-to-many relation', () => {
    const ignored = fixtureSchemaText('ignored-model-many-to-many');
    expect(storageOf(ignored)).toStrictEqual(
      storageOf(withoutIgnoreOn(withoutModelIgnore(ignored), ['tags'])),
    );
  });

  // Model `Loose` has no @id and stays ignored on both sides: Prisma 7 and Prisma 8 both refuse a model with no unique criteria unignored.
  it('on models that reference each other across schemas, and a relation field to one of them', () => {
    const ignored = fixtureSchemaText('ignored-models');
    const unignored = withoutIgnoreOn(
      withoutModelIgnore(withoutModelIgnore(ignored, 'Archive'), 'ArchiveEntry'),
      ['archive'],
    );
    expect(storageOf(ignored)).toStrictEqual(storageOf(unignored));
  });
});
