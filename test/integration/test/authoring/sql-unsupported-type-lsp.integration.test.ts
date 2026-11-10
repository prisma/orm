import { pathToFileURL } from 'node:url';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { resolveConfigInputs } from '../../../../packages/1-framework/3-tooling/language-server/src/config-resolution';
import { DocumentStore } from '../../../../packages/1-framework/3-tooling/language-server/src/document-store';
import { ProjectArtifacts } from '../../../../packages/1-framework/3-tooling/language-server/src/project-artifacts';

const fixtureDir = join(
  import.meta.dirname,
  '../fixtures/cli/cli-test-app/fixtures/lsp-workspace-packages',
);
const configPath = join(fixtureDir, 'prisma.config.ts');
const schemaPath = join(fixtureDir, 'contract.prisma');

const schema = `// use prisma-8

model Doc {
  id   Int @id
  meta Unsupported("hstore")
}
`;

describe('the language server in a Postgres project', () => {
  it('names a field typed Unsupported("x") as no Prisma 8 type', async () => {
    const uri = pathToFileURL(schemaPath).href;
    const documents = new DocumentStore();
    documents.open({ uri, languageId: 'prisma', version: 1, text: schema });

    const resolution = await resolveConfigInputs(configPath, (readUri) => documents.text(readUri));
    const project = new ProjectArtifacts({
      ...resolution,
      onInterpretationError: () => {},
      readSnapshot: documents.readSnapshot,
    });

    expect(project.diagnostics(uri).map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          'Unsupported("hstore") is not a Prisma 8 type. Write the column\'s type with a type constructor, or as Raw(sql`hstore`) when no type constructor names it. If "hstore" comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts.',
      },
    ]);
  });
});
