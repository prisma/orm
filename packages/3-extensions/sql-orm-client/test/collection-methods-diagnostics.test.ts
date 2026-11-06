import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(testDir, 'collection-methods-diagnostics.virtual.ts');

const fixture = `
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { createCollectionMethodsOrm } from './collection-methods-orm-fixture';

const { plain, extended } = createCollectionMethodsOrm();
const q = websearchToTsquery('alice');
plain.User.using.search(q);
plain.Comment.using.users_search(q);
extended.Tag.using.labelled('x');
`;

function fixtureDiagnostics(): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(
    resolve(testDir, '../tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!config) throw new Error('tsconfig.json could not be read');
  const options = { ...config.options, noEmit: true };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (file) => (file === fixturePath ? fixture : readFile(file));
  host.fileExists = (file) => file === fixturePath || fileExists(file);
  const program = ts.createProgram([fixturePath], options, host);
  const source = program.getSourceFile(fixturePath);
  if (source === undefined) throw new Error('fixture not in program');
  return [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ].map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

describe('the errors for collection methods', () => {
  it('name the model for a missing method, and the model and contributions for a clash', () => {
    const collection = (model: string) =>
      `Collection<Contract, "${model}", DefaultModelRow<Contract, "${model}", "public">, WithNsId<DefaultCollectionTypeState, "public">>`;
    expect(fixtureDiagnostics()).toEqual([
      `Property 'search' does not exist on type 'ContributedCollectionMethods<Contract, "User", "public", ${collection('User')}, MergedTable<...>>'.`,
      `Property 'users_search' does not exist on type 'ContributedCollectionMethods<Contract, "Comment", "public", ${collection('Comment')}, MergedTable<...>>'.`,
      `This expression is not callable.\n  Type 'CollectionMethodNameClash<"labelled", "Tag", "test/clash-a" | "test/clash-b">' has no call signatures.`,
    ]);
  });
});
