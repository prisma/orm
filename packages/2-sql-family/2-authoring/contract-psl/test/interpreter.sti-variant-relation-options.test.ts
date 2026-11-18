import { describe, expect, it } from 'vitest';
import {
  actor,
  botWithOwner,
  contactOf,
  diagnosticsOf,
  humanWithContact,
  tablesOf,
} from './sti-variant-support';

const contactWithBots = contactOf('  bots BotActor[] @relation("Bot")');

describe('the options of a relation on a single-table variant', () => {
  it('refuses a foreign key whose column has a default the other variants would get', () => {
    const schema = [
      contactOf(''),
      actor,
      humanWithContact('').replace('contactId Int', 'contactId Int     @default(1)'),
    ].join('\n\n');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Model "HumanActor" declares a foreign key on (contactId), but column "contactId" has a default, which the rows of the other variants of "Actor" get too (single-table inheritance). Remove the default.',
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: schema.indexOf('@relation("Human", fields') }),
        }),
      }),
    ]);
  });

  it('reports a named index that does not exist at the relation', () => {
    const schema = [
      contactOf(''),
      actor,
      humanWithContact('').replace('onDelete: Cascade)', 'onDelete: Cascade, index: "missing")'),
    ].join('\n\n');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: schema.indexOf('@relation("Human", fields') }),
        }),
      }),
    ]);
  });

  it('treats index: true and an omitted index as the same foreign key in two variants', () => {
    const tables = tablesOf(
      [
        contactWithBots,
        actor,
        humanWithContact('').replace('onDelete: Cascade)', 'onDelete: Cascade, index: true)'),
        botWithOwner('Contact'),
      ].join('\n\n'),
    );

    expect(tables['actor']?.foreignKeys).toHaveLength(1);
  });

  it('accepts the index a variant relation names as its backing index', () => {
    const tables = tablesOf(
      [
        contactOf(''),
        actor,
        humanWithContact('  @@index([contactId], map: "human_contact")').replace(
          'onDelete: Cascade)',
          'onDelete: Cascade, index: "human_contact")',
        ),
      ].join('\n\n'),
    );

    expect(tables['actor']).toMatchObject({
      indexes: [{ name: 'human_contact', columns: ['contactId'] }],
      foreignKeys: [{ source: { columns: ['contactId'] }, index: { name: 'human_contact' } }],
    });
  });
});
