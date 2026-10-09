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
});
