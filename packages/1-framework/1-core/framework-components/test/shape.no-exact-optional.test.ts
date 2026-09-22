import { dirname, join } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const fixturePath = join(
  dirname(new URL(import.meta.url).pathname),
  '__virtual__',
  'shape-fixture.ts',
);

const fixture = `
import type { RelationKeys, RelationNamesOf, Scalars } from '../../src/execution/shape';

type Profile = { id: number; bio: string | null; readonly [RelationKeys]?: never };
type User = { id: number; name: string; posts: number[]; readonly [RelationKeys]?: 'posts' };
type Chore = { id: number; type: 'chore'; readonly [RelationKeys]?: never };
type Task = User | Chore;

export type ProfileScalars = Scalars<Profile>;
export type UserScalars = Scalars<User>;
export type TaskScalars = Scalars<Task>;
export type UserRelations = RelationNamesOf<User>;
export type ProfileRelations = RelationNamesOf<Profile>;
`;

function compileFixture(exactOptionalPropertyTypes: boolean) {
  const options: ts.CompilerOptions = {
    strict: true,
    exactOptionalPropertyTypes,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts'],
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile;
  const fileExists = host.fileExists;
  host.readFile = (file) => (file === fixturePath ? fixture : readFile(file));
  host.fileExists = (file) => file === fixturePath || fileExists(file);
  const program = ts.createProgram([fixturePath], options, host);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  expect(diagnostics).toEqual([]);
  const source = program.getSourceFile(fixturePath);
  if (source === undefined) throw new Error('fixture not in program');
  const checker = program.getTypeChecker();
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!);
  const typeOf = (name: string) => {
    const symbol = exports.find((s) => s.name === name);
    if (symbol === undefined) throw new Error(`fixture does not export ${name}`);
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    expect(type.flags & ts.TypeFlags.Any).toBe(0);
    return type;
  };
  const propertyNames = (name: string) =>
    checker
      .getPropertiesOfType(typeOf(name))
      .map((p) => p.name)
      .sort();
  const unionMemberPropertyNames = (name: string) => {
    const type = typeOf(name);
    expect(type.isUnion()).toBe(true);
    return (type as ts.UnionType).types.map((t) =>
      checker
        .getPropertiesOfType(t)
        .map((p) => p.name)
        .sort(),
    );
  };
  const typeText = (name: string) =>
    checker.typeToString(typeOf(name), undefined, ts.TypeFormatFlags.InTypeAlias);
  return { propertyNames, unionMemberPropertyNames, typeText };
}

describe.each([false, true])('Scalars with exactOptionalPropertyTypes: %s', (exact) => {
  const compiled = compileFixture(exact);

  it('keeps every field of a model with no relations', () => {
    expect(compiled.propertyNames('ProfileScalars')).toEqual(['bio', 'id']);
  });

  it('drops relation keys and the phantom', () => {
    expect(compiled.propertyNames('UserScalars')).toEqual(['id', 'name']);
  });

  it('distributes over a union', () => {
    expect(compiled.unionMemberPropertyNames('TaskScalars')).toEqual([
      ['id', 'name'],
      ['id', 'type'],
    ]);
  });

  it('names the relations and nothing else', () => {
    expect(compiled.typeText('UserRelations')).toBe('"posts"');
    expect(compiled.typeText('ProfileRelations')).toBe('never');
  });
});
