import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(testDir, 'codec-field-diagnostics.virtual.ts');

const fixture = `
import type { CodecField } from '../src/types';
import { createFragmentsOrm, type SoftDeleteContract } from './fragments-fixture';

type DeletedAt = CodecField<SoftDeleteContract, 'pg/timestamptz-temporal@1', true>;
const notDeleted = (row: { deletedAt: DeletedAt }) => row.deletedAt.isNull();

const { db } = createFragmentsOrm();
db.Post.where(notDeleted);
db.Tag.where(notDeleted);
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

describe('a refused CodecField fragment', () => {
  it('reports each overload of where, and the first names the missing field', () => {
    const diagnostics = fixtureDiagnostics();
    expect(diagnostics).toHaveLength(1);
    const [message] = diagnostics;
    expect(message).toMatch(/^No overload matches this call\./);
    expect(message).toContain('Overload 1 of 3');
    expect(message).toContain(
      'Property \'deletedAt\' is missing in type \'ModelAccessor<Contract, "Tag", "public">\'',
    );
  });
});
