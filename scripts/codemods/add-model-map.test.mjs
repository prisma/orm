import { strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addModelMaps, UnhandledModelError } from './add-model-map.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

describe('addModelMaps', () => {
  it('appends @@map with the first letter lowered as the last line of a model block', () => {
    const input = ['model UserProfile {', '  id Int @id', '}', ''].join('\n');
    const expected = [
      'model UserProfile {',
      '  id Int @id',
      '  @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('inserts after existing block attributes such as @@index', () => {
    const input = [
      'model OrderItem {',
      '  id      Int @id',
      '  orderId Int',
      '',
      '  @@index([orderId])',
      '}',
      '',
    ].join('\n');
    const expected = [
      'model OrderItem {',
      '  id      Int @id',
      '  orderId Int',
      '',
      '  @@index([orderId])',
      '  @@map("orderItem")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('leaves a model that already has @@map untouched', () => {
    const input = ['model TeamMember {', '  id Int @id', '  @@map("team_member")', '}', ''].join(
      '\n',
    );
    strictEqual(addModelMaps(input), input);
  });

  it('matches the indentation of the block fields', () => {
    const input = ['model UserProfile {', '    id Int @id', '}', ''].join('\n');
    const expected = [
      'model UserProfile {',
      '    id Int @id',
      '    @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('ignores enum, view, native_enum and other block kinds', () => {
    const input = [
      'datasource db {',
      '  provider = "postgresql"',
      '}',
      '',
      'enum OrderStatus {',
      '  PENDING',
      '  SHIPPED',
      '}',
      '',
      'native_enum PaymentKind {',
      '  CARD',
      '}',
      '',
      'view ActiveUser {',
      '  id Int',
      '}',
      '',
      'type ShippingAddress {',
      '  street String',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), input);
  });

  it('leaves a variant with @@base and no @@map alone because it shares the base storage', () => {
    const input = [
      'model Task {',
      '  id   Int    @id',
      '  kind String',
      '',
      '  @@discriminator(kind)',
      '}',
      '',
      'model BugReport {',
      '  id       Int    @id',
      '  severity String',
      '',
      '  @@base(Task, "bug")',
      '}',
      '',
    ].join('\n');
    const expected = [
      'model Task {',
      '  id   Int    @id',
      '  kind String',
      '',
      '  @@discriminator(kind)',
      '  @@map("task")',
      '}',
      '',
      'model BugReport {',
      '  id       Int    @id',
      '  severity String',
      '',
      '  @@base(Task, "bug")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('handles a Mongo-style model', () => {
    const input = [
      'model UserProfile {',
      '  id       ObjectId @id @map("_id")',
      '  nickname String',
      '}',
      '',
    ].join('\n');
    const expected = [
      'model UserProfile {',
      '  id       ObjectId @id @map("_id")',
      '  nickname String',
      '  @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('handles several models in one file, mapping only the unmapped ones', () => {
    const input = [
      'model UserProfile {',
      '  id Int @id',
      '}',
      '',
      'model TeamMember {',
      '  id Int @id',
      '',
      '  @@map("team_member")',
      '}',
      '',
      'model OrderItem {',
      '  id Int @id',
      '}',
      '',
    ].join('\n');
    const expected = [
      'model UserProfile {',
      '  id Int @id',
      '  @@map("userProfile")',
      '}',
      '',
      'model TeamMember {',
      '  id Int @id',
      '',
      '  @@map("team_member")',
      '}',
      '',
      'model OrderItem {',
      '  id Int @id',
      '  @@map("orderItem")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('handles a model written on a single line', () => {
    const input = 'model UserProfile { id Int @id email String? @unique }\n';
    const expected =
      'model UserProfile { id Int @id email String? @unique @@map("userProfile") }\n';
    strictEqual(addModelMaps(input), expected);
    strictEqual(addModelMaps(expected), expected);
  });

  it('handles a header line that ends in a comment', () => {
    const input = ['model UserProfile { // keep', '  id Int @id', '}', ''].join('\n');
    const expected = [
      'model UserProfile { // keep',
      '  id Int @id',
      '  @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('recognises @@map and @@base written with a space before the parenthesis', () => {
    const input = [
      'model TeamMember {',
      '  id Int @id',
      '  @@map ("team_member")',
      '}',
      '',
      'model BugReport {',
      '  id Int @id',
      '  @@base (Task, "bug")',
      '}',
      '',
      'model OrderItem { id Int @id @@map ("order_item") }',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), input);
  });

  it('handles an indented header whose brace sits on the next line', () => {
    const input = [
      'namespace auth {',
      '  model UserProfile',
      '  {',
      '    id Int @id',
      '  }',
      '}',
      '',
    ].join('\n');
    const expected = [
      'namespace auth {',
      '  model UserProfile',
      '  {',
      '    id Int @id',
      '    @@map("userProfile")',
      '  }',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('handles a header whose body starts on the same line', () => {
    const input = ['model UserProfile {   id Int @id', '  email String', '}', ''].join('\n');
    const expected = [
      'model UserProfile {   id Int @id',
      '  email String',
      '  @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
    const mapped = ['model TeamMember {   @@map("team_member")', '  id Int @id', '}', ''].join(
      '\n',
    );
    strictEqual(addModelMaps(mapped), mapped);
  });

  it('leaves a field named model inside a block it does not descend into alone', () => {
    const input = ['type Device {', '  model String', '  serial String', '}', ''].join('\n');
    strictEqual(addModelMaps(input), input);
  });

  it('handles a header with a blank line before its brace', () => {
    const input = ['model UserProfile', '', '{', '  id Int @id', '}', ''].join('\n');
    const expected = [
      'model UserProfile',
      '',
      '{',
      '  id Int @id',
      '  @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('leaves a field named model whose line carries a brace alone', () => {
    const input = [
      'type Device {',
      '  model    Json   @default("{}")',
      '  settings Json   @default("{ \\"dark\\": true }")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), input);
  });

  it('handles a comment line between the model name and its brace', () => {
    const input = ['model UserProfile', '// one row per user', '{', '  id Int @id', '}', ''].join(
      '\n',
    );
    const expected = [
      'model UserProfile',
      '// one row per user',
      '{',
      '  id Int @id',
      '  @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('keeps working when a model block has a field named model', () => {
    const input = ['model Device {', '  id    Int    @id', '  model String', '}', ''].join('\n');
    const expected = [
      'model Device {',
      '  id    Int    @id',
      '  model String',
      '  @@map("device")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('ends a block at a closing brace that carries a comment', () => {
    const input = [
      'model UserProfile {',
      '  id Int @id',
      '} // keep',
      '',
      'model TeamMember {',
      '  id Int @id',
      '}',
      '',
      'model OrderItem { id Int @id } // one line',
      '',
    ].join('\n');
    const expected = [
      'model UserProfile {',
      '  id Int @id',
      '  @@map("userProfile")',
      '} // keep',
      '',
      'model TeamMember {',
      '  id Int @id',
      '  @@map("teamMember")',
      '}',
      '',
      'model OrderItem { id Int @id @@map("orderItem") } // one line',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('refuses a model block that never closes', () => {
    throws(() => addModelMaps('model UserProfile {\n  id Int @id\n'), UnhandledModelError);
  });

  it('refuses a model header it does not understand instead of skipping it', () => {
    const input = ['model UserProfile extends', '{', '  id Int @id', '}', ''].join('\n');
    throws(
      () => addModelMaps(input),
      (error) => {
        strictEqual(error instanceof UnhandledModelError, true);
        strictEqual(error.lineNumbers.join(','), '1');
        return true;
      },
    );
  });

  it('keeps CRLF line endings on the inserted line', () => {
    const input = 'model UserProfile {\r\n  id Int @id\r\n}\r\n';
    const expected = 'model UserProfile {\r\n  id Int @id\r\n  @@map("userProfile")\r\n}\r\n';
    strictEqual(addModelMaps(input), expected);
  });

  it('is byte-identical to the copy shipped in the pending upgrade fragment', () => {
    const repoCopy = readFileSync(`${here}add-model-map.mjs`, 'utf8');
    const fragmentCopy = readFileSync(
      `${here}../../upgrade-instructions/pending/psl-verbatim-table-names/app/scripts/add-model-map.mjs`,
      'utf8',
    );
    strictEqual(fragmentCopy, repoCopy);
  });

  it('is idempotent', () => {
    const input = ['model UserProfile {', '  id Int @id', '}', ''].join('\n');
    const once = addModelMaps(input);
    strictEqual(addModelMaps(once), once);
  });
});
