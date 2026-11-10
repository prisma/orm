import { timeouts } from '@repo/test-utils';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { prisma7ConfigFile } from '../../../src/commands/init/templates/code-templates';

function syntaxErrors(source: string): readonly string[] {
  const { diagnostics = [] } = ts.transpileModule(source, { reportDiagnostics: true });
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  );
}

function findNode<T extends ts.Node>(
  node: ts.Node,
  matches: (candidate: ts.Node) => candidate is T,
): T | undefined {
  return matches(node) ? node : ts.forEachChild(node, (child) => findNode(child, matches));
}

/** The string literal values of `prisma7Schema(<schema>)` and `output: <output>` in the config. */
function configLiterals(source: string): {
  readonly schema: string | undefined;
  readonly output: string | undefined;
} {
  const file = ts.createSourceFile('prisma.config.ts', source, ts.ScriptTarget.Latest);
  const call = findNode(
    file,
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) && node.expression.getText(file) === 'prisma7Schema',
  );
  const output = findNode(
    file,
    (node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) && node.name.getText(file) === 'output',
  );
  const schemaArgument = call?.arguments[0];
  return {
    schema:
      schemaArgument !== undefined && ts.isStringLiteral(schemaArgument)
        ? schemaArgument.text
        : undefined,
    output:
      output !== undefined && ts.isStringLiteral(output.initializer)
        ? output.initializer.text
        : undefined,
  };
}

describe('prisma7ConfigFile', { timeout: timeouts.typeScriptCompilation }, () => {
  it.each([
    ['a plain path', 'prisma/schema.prisma', 'src/prisma'],
    ['a single quote', "prisma/O'Reilly/schema.prisma", "src/O'Reilly"],
    ['a double quote', 'prisma/"quoted"/schema.prisma', 'src/"quoted"'],
  ])(
    'writes paths with %s as string literals equal to the paths',
    (_case, schemaPath, outputDir) => {
      const source = prisma7ConfigFile('postgres', schemaPath, outputDir);

      expect(syntaxErrors(source)).toEqual([]);
      expect(configLiterals(source)).toEqual({ schema: schemaPath, output: outputDir });
    },
  );
});
