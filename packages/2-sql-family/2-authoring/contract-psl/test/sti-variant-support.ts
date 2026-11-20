import type { SqlStorage } from '@internal/sql-contract/types';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const controlMutationDefaults = createBuiltinLikeControlMutationDefaults();

export function interpret(schema: string) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    ...fixtureInterpreterTypes,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults,
  });
}

export function tablesOf(schema: string) {
  const result = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const storage = result.value.storage as SqlStorage;
  return storage.namespaces['public']?.entries.table ?? {};
}

export function diagnosticsOf(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected the schema to be refused');
  return result.failure.diagnostics;
}

export const contactOf = (backRelations: string) => `model Contact {
  id     Int          @id
  humans HumanActor[] @relation("Human")
${backRelations}
  @@map("contact")
}`;

export const contact = contactOf('');

export const team = `model Team {
  id   Int        @id
  bots BotActor[] @relation("Bot")

  @@map("team")
}`;

export const actor = `model Actor {
  id   Int    @id
  kind String

  @@discriminator(kind)
  @@map("actor")
}`;

export const humanWithContact = (body: string) => `model HumanActor {
  contact   Contact  @relation("Human", fields: [contactId], references: [id], onDelete: Cascade)
  contactId Int
  email     String?
${body}
  @@base(Actor, "human")
}`;

export const botWithOwner = (target: 'Contact' | 'Team') => `model BotActor {
  owner     ${target} @relation("Bot", fields: [contactId], references: [id], onDelete: Cascade)
  contactId Int

  @@base(Actor, "bot")
}`;
