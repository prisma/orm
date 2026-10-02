import { pathToFileURL } from 'node:url';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { mongoContextInput } from '@internal/mongo-contract-psl/test';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { resolveConfigInputs } from '../../../../packages/1-framework/3-tooling/language-server/src/config-resolution';
import { DocumentStore } from '../../../../packages/1-framework/3-tooling/language-server/src/document-store';
import { ProjectArtifacts } from '../../../../packages/1-framework/3-tooling/language-server/src/project-artifacts';

const configPath = join(import.meta.dirname, 'lsp-emit-parity-mongo/_fixture/prisma.config.ts');
const schemaPath = join(import.meta.dirname, 'lsp-emit-parity-mongo/_fixture/schema.prisma');

const schema = `// use prisma-8

model Post {
  id    ObjectId @id @map("_id")
  value BigInt
}
`;

describe('the language server and the provider agree on Mongo earlier-name wording', () => {
  it('reports the same PSL_UNRESOLVED_REFERENCE message for a field typed with a scalar name an earlier Prisma used', async () => {
    const uri = pathToFileURL(schemaPath).href;
    const documents = new DocumentStore();
    documents.open({ uri, languageId: 'prisma', version: 1, text: schema });

    const resolution = await resolveConfigInputs(configPath, (readUri) => documents.text(readUri));
    const interpretation = resolution.interpretation;
    expect(interpretation).toBeDefined();
    if (interpretation === undefined) return;

    const bound = bindPslSchema(schema, { sourceId: uri, context: interpretation.context });
    const providerResult = withSeedDiagnostics(
      interpretPslDocumentToMongoContract({
        documents: bound.documents,
        sources: bound.sources,
        symbolTable: bound.symbolTable,
        binder: bound.binder,
        ...mongoContextInput(bound.context),
      }),
      bound.seedDiagnostics,
    );
    expect(providerResult.ok).toBe(false);
    if (providerResult.ok) return;
    const providerMessage = providerResult.failure.diagnostics.find(
      (diagnostic) => diagnostic.code === 'PSL_UNRESOLVED_REFERENCE',
    )?.message;
    expect(providerMessage).toBe(
      'Field "Post.value" has type "BigInt", which is not a Mongo scalar type; use "Int64" (stored as BSON long).',
    );

    const project = new ProjectArtifacts({
      ...resolution,
      onInterpretationError: () => {},
      readSnapshot: documents.readSnapshot,
    });
    const lspMessage = project
      .diagnostics(uri)
      .find((diagnostic) => diagnostic.code === 'PSL_UNRESOLVED_REFERENCE')?.message;

    expect(lspMessage).toBe(providerMessage);
  });
});
