// Moves every Prisma 8 client call that passes `contractJson` to a contract value:
//   postgres<Contract>({ contractJson, url })
// becomes
//   export const contract = contractFromJson<Contract>(contractJson);
//   postgres({ contract, url })
//
// Usage: node contract-from-json.ts [project-root] [--typescript <path to the typescript package>]
//
// The script reads source files with the TypeScript compiler, which it loads from the project.
// It rewrites each source file it can move, and prints it. In a module with a default export, such
// as a Worker entry, it declares `contract` without `export` and says so. It prints to stderr, with the reason,
// each file that passes `contractJson` to a client but that it did not move: a test file, a file
// that already has another binding named `contract`, a file whose clients use different contracts,
// a file whose `contractJson` value is not readable at the top of the file, or a call it cannot
// read. A `contract` destructured from the moved call is dropped from the destructuring. It exits 1 when it printed such a file, and changes nothing and exits 1
// when TypeScript is not installed or an argument is wrong. It skips node_modules, dist, build and every directory whose
// name starts with a dot, such as .git, .agents or .claude, and links that lead nowhere.

import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import type * as TS from 'typescript';

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;
const TEST_FILE = /\.(?:test|spec)(?:-d)?\.[cm]?tsx?$/;
const TEST_DIRECTORIES = new Set(['test', 'tests', '__tests__']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const FACADE_ENTRY =
  /^@prisma\/orm-(postgres|sqlite|mongo)\/(?:runtime|serverless|static|query-builder)$/;
const SUPABASE_ENTRY = '@prisma/orm-extension-supabase/runtime';
const FACTORY_EXPORTS = new Set(['default', 'supabase', 'mongoQuery']);
const DETECTION =
  /(?<![\w$.])(?:postgres|postgresServerless|sqlite|supabase|mongo|postgresStatic|sqliteStatic|mongoStatic|mongoQuery)(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]/;

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface MovedCall {
  readonly node: TS.CallExpression;
  readonly edits: readonly Edit[];
  readonly typeArguments: string;
  readonly json: string;
  readonly jsonNames: readonly string[];
  readonly staticEntry: string;
}

type Outcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rewritten'; readonly source: string; readonly exported: boolean }
  | { readonly kind: 'refused'; readonly reason: string };

function staticEntryOf(specifier: string): string | undefined {
  const facade = FACADE_ENTRY.exec(specifier);
  if (facade !== null) return `@prisma/orm-${facade[1]}/static`;
  return specifier === SUPABASE_ENTRY ? '@prisma/orm-postgres/static' : undefined;
}

function specifierOf(ts: typeof TS, statement: TS.ImportDeclaration): string {
  return ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
}

function compareSpecifiers(left: string, right: string): number {
  const rank = (specifier: string) =>
    specifier.startsWith('node:') ? 0 : specifier.startsWith('.') ? 2 : 1;
  return rank(left) - rank(right) || (left < right ? -1 : left > right ? 1 : 0);
}

function factoriesOf(ts: typeof TS, imports: readonly TS.ImportDeclaration[]) {
  const factories = new Map<string, string>();
  for (const statement of imports) {
    const clause = statement.importClause;
    const staticEntry = staticEntryOf(specifierOf(ts, statement));
    if (clause === undefined || clause.isTypeOnly || staticEntry === undefined) continue;
    if (clause.name !== undefined) factories.set(clause.name.text, staticEntry);
    const bindings = clause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (!element.isTypeOnly && FACTORY_EXPORTS.has(imported)) {
        factories.set(element.name.text, staticEntry);
      }
    }
  }
  return factories;
}

function topLevelNames(ts: typeof TS, sourceFile: TS.SourceFile) {
  const imported = new Set<string>();
  const declared = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name !== undefined) imported.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings))
        imported.add(bindings.name.text);
      else for (const element of bindings?.elements ?? []) imported.add(element.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(ts, declaration.name)) declared.add(name);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      declared.add(statement.name.text);
    }
  }
  return { imported, declared };
}

function bindingIdentifiers(ts: typeof TS, name: TS.BindingName): TS.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingIdentifiers(ts, element.name),
  );
}

function bindingNames(ts: typeof TS, name: TS.BindingName): string[] {
  return bindingIdentifiers(ts, name).map((identifier) => identifier.text);
}

function bindingsOf(ts: typeof TS, root: TS.Node, wanted: string): TS.Node[] {
  const found: TS.Node[] = [];
  const visit = (node: TS.Node): void => {
    const binding = ownBindingOf(ts, node, wanted);
    if (binding !== undefined) found.push(binding);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function ownBindingOf(ts: typeof TS, node: TS.Node, wanted: string): TS.Node | undefined {
  if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
    return bindingIdentifiers(ts, node.name).find((name) => name.text === wanted);
  }
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isExportSpecifier(node) ||
      ts.isNamespaceExport(node) ||
      ts.isImportSpecifier(node) ||
      ts.isNamespaceImport(node) ||
      ts.isImportClause(node)) &&
    node.name !== undefined &&
    ts.isIdentifier(node.name) &&
    node.name.text === wanted
  ) {
    return node.name;
  }
  return undefined;
}

/** Whether `identifier` names a variable the file declares at its top level. */
function isTopLevelVariable(ts: typeof TS, identifier: TS.Node): boolean {
  let node = identifier.parent;
  while (
    ts.isBindingElement(node) ||
    ts.isObjectBindingPattern(node) ||
    ts.isArrayBindingPattern(node)
  )
    node = node.parent;
  return (
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent)
  );
}

function topLevelStatementOf(ts: typeof TS, node: TS.Node): TS.Node | undefined {
  let current = node;
  while (current.parent !== undefined && !ts.isSourceFile(current.parent)) current = current.parent;
  return current.parent === undefined ? undefined : current;
}

/** The edit that drops `contract` from `const { ..., contract } = client(...)`, whose value the moved declaration now holds. */
function destructuredContractEdit(
  ts: typeof TS,
  sourceFile: TS.SourceFile,
  call: TS.CallExpression,
  exported: boolean,
): { readonly binding: TS.Node; readonly edit: Edit } | undefined {
  const declaration = call.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== call) return undefined;
  const pattern = declaration.name;
  if (!ts.isObjectBindingPattern(pattern)) return undefined;
  if (pattern.elements.some((element) => element.dotDotDotToken !== undefined)) return undefined;
  const index = pattern.elements.findIndex(
    (element) =>
      element.propertyName === undefined &&
      element.initializer === undefined &&
      ts.isIdentifier(element.name) &&
      element.name.text === 'contract',
  );
  const element = pattern.elements[index];
  if (element === undefined) return undefined;
  const statement = declaration.parent.parent;
  const isExported =
    ts.isVariableStatement(statement) &&
    (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  if (isExported && !exported) return undefined;
  if (pattern.elements.length === 1) {
    if (
      !ts.isVariableStatement(statement) ||
      isExported ||
      statement.declarationList.declarations.length !== 1
    )
      return undefined;
    return {
      binding: element.name,
      edit: { start: statement.getStart(sourceFile), end: call.getStart(sourceFile), text: '' },
    };
  }
  const next = pattern.elements[index + 1];
  const previous = pattern.elements[index - 1];
  const edit =
    next !== undefined
      ? { start: element.getStart(sourceFile), end: next.getStart(sourceFile), text: '' }
      : { start: previous?.end ?? element.getStart(sourceFile), end: element.end, text: '' };
  return { binding: element.name, edit };
}

function isReference(ts: typeof TS, identifier: TS.Identifier): boolean {
  const parent = identifier.parent;
  return !(
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isQualifiedName(parent) && parent.right === identifier) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
      parent.name === identifier)
  );
}

function identifiersIn(ts: typeof TS, node: TS.Node): string[] {
  const names: string[] = [];
  const visit = (child: TS.Node): void => {
    if (ts.isIdentifier(child) && isReference(ts, child)) names.push(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function contractJsonProperty(ts: typeof TS, object: TS.ObjectLiteralExpression) {
  return object.properties.find(
    (property): property is TS.ShorthandPropertyAssignment | TS.PropertyAssignment =>
      (ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === 'contractJson',
  );
}

function movedCalls(
  ts: typeof TS,
  sourceFile: TS.SourceFile,
  factories: ReadonlyMap<string, string>,
): MovedCall[] {
  const source = sourceFile.text;
  const calls: MovedCall[] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const staticEntry = factories.get(node.expression.text);
      const [options] = node.arguments;
      const property =
        options !== undefined && ts.isObjectLiteralExpression(options)
          ? contractJsonProperty(ts, options)
          : undefined;
      if (staticEntry !== undefined && property !== undefined) {
        const edits: Edit[] = [
          { start: property.getStart(sourceFile), end: property.end, text: 'contract' },
        ];
        const typeArguments = node.typeArguments;
        if (typeArguments !== undefined) {
          edits.push({
            start: node.expression.end,
            end: source.indexOf('>', typeArguments.end) + 1,
            text: '',
          });
        }
        calls.push({
          node,
          edits,
          typeArguments:
            typeArguments === undefined
              ? ''
              : `<${typeArguments.map((type) => type.getText(sourceFile)).join(', ')}>`,
          json: ts.isPropertyAssignment(property)
            ? property.initializer.getText(sourceFile)
            : 'contractJson',
          jsonNames: ts.isPropertyAssignment(property)
            ? identifiersIn(ts, property.initializer)
            : ['contractJson'],
          staticEntry,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function importEdit(
  ts: typeof TS,
  sourceFile: TS.SourceFile,
  imports: readonly TS.ImportDeclaration[],
  staticEntry: string,
  style: { readonly quote: string; readonly semicolon: string; readonly eol: string },
): Edit | { readonly after: string } {
  const existing = imports.find(
    (statement) =>
      specifierOf(ts, statement) === staticEntry &&
      statement.importClause !== undefined &&
      !statement.importClause.isTypeOnly,
  );
  const clause = existing?.importClause;
  const bindings = clause?.namedBindings;
  if (bindings !== undefined && ts.isNamedImports(bindings)) {
    const first = bindings.elements[0];
    return first === undefined
      ? { start: bindings.getStart(sourceFile), end: bindings.end, text: '{ contractFromJson }' }
      : {
          start: first.getStart(sourceFile),
          end: first.getStart(sourceFile),
          text: 'contractFromJson, ',
        };
  }
  if (clause?.name !== undefined && bindings === undefined) {
    return { start: clause.name.end, end: clause.name.end, text: ', { contractFromJson }' };
  }
  const line = `import { contractFromJson } from ${style.quote}${staticEntry}${style.quote}${style.semicolon}`;
  const before = imports.find(
    (statement) =>
      statement.importClause !== undefined &&
      compareSpecifiers(specifierOf(ts, statement), staticEntry) > 0,
  );
  if (before === undefined) return { after: `${style.eol}${line}` };
  const at = before.getStart(sourceFile);
  return { start: at, end: at, text: `${line}${style.eol}` };
}

export function moveFile(ts: typeof TS, fileName: string, source: string): Outcome {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const calls = movedCalls(ts, sourceFile, factoriesOf(ts, imports));
  const first = calls[0];
  if (first === undefined) {
    return DETECTION.test(source)
      ? {
          kind: 'refused',
          reason: 'it passes contractJson to a client in a form the script cannot read',
        }
      : { kind: 'unchanged' };
  }
  if (
    calls.some(
      (call) =>
        call.json !== first.json ||
        call.typeArguments !== first.typeArguments ||
        call.staticEntry !== first.staticEntry,
    )
  ) {
    return {
      kind: 'refused',
      reason: 'its clients use different contracts; give each its own contractFromJson value',
    };
  }
  const names = topLevelNames(ts, sourceFile);
  const topLevelStatement = topLevelStatementOf(ts, first.node);
  const inner = first.jsonNames.find(
    (name) =>
      topLevelStatement !== undefined &&
      bindingsOf(ts, topLevelStatement, name).some((found) => !isTopLevelVariable(ts, found)),
  );
  if (inner !== undefined) {
    return {
      kind: 'refused',
      reason: `its contractJson value uses ${inner}, which is a parameter or local binding where the client is created, not a value the top of the file can read; pass contract: contractFromJson${first.typeArguments}(${first.json}) to the call instead of contractJson, and import contractFromJson from ${first.staticEntry}`,
    };
  }
  const exported = !hasDefaultExport(ts, sourceFile);
  const destructured = calls
    .map((call) => destructuredContractEdit(ts, sourceFile, call.node, exported))
    .filter((found) => found !== undefined);
  const binding = bindingsOf(ts, sourceFile, 'contract').find(
    (found) => !destructured.some((entry) => entry.binding === found),
  );
  if (binding !== undefined) {
    const line = sourceFile.getLineAndCharacterOfPosition(binding.getStart(sourceFile)).line + 1;
    return {
      kind: 'refused',
      reason: ts.isExportSpecifier(binding.parent)
        ? `it exports contract in an export statement (line ${line}); remove contract from that statement and run the script again`
        : `it already has a binding named contract (line ${line}); rename that binding and run the script again`,
    };
  }
  const local = first.jsonNames.find((name) => names.declared.has(name));
  if (local !== undefined) {
    return {
      kind: 'refused',
      reason: `its contractJson value uses ${local}, which the file declares after its imports; declare the contract value after ${local} by hand`,
    };
  }

  const lastImport = imports.at(-1);
  if (lastImport === undefined) {
    return { kind: 'refused', reason: 'it imports no client' };
  }
  const firstImport = imports[0];
  const firstImportText = firstImport?.getText(sourceFile) ?? '';
  const style = {
    quote: firstImport?.moduleSpecifier.getText(sourceFile).startsWith('"') ? '"' : "'",
    semicolon: firstImportText.endsWith(';') ? ';' : '',
    eol: source.includes('\r\n') ? '\r\n' : '\n',
  };
  const edits: Edit[] = [
    ...calls.flatMap((call) => call.edits),
    ...destructured.map((entry) => entry.edit),
  ];
  const staticImport = importEdit(ts, sourceFile, imports, first.staticEntry, style);
  const importedAfter = 'after' in staticImport ? staticImport.after : '';
  if ('start' in staticImport) edits.push(staticImport);

  let afterImports = lastImport.end;
  while (source[afterImports] === '\r' || source[afterImports] === '\n') afterImports++;
  const declaration = `${exported ? 'export ' : ''}const contract = contractFromJson${first.typeArguments}(${first.json})${style.semicolon}`;
  edits.push({
    start: lastImport.end,
    end: afterImports,
    text: `${importedAfter}${style.eol}${style.eol}${declaration}${style.eol}${afterImports < source.length ? style.eol : ''}`,
  });

  let moved = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    moved = moved.slice(0, edit.start) + edit.text + moved.slice(edit.end);
  }
  return { kind: 'rewritten', source: moved, exported };
}

function hasDefaultExport(ts: typeof TS, sourceFile: TS.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      (ts.isExportAssignment(statement) && !statement.isExportEquals) ||
      (ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some((element) => element.name.text === 'default')) ||
      (ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ??
          false)),
  );
}

function isTestPath(path: string): boolean {
  return TEST_FILE.test(path) || path.split(/[\\/]/).some((part) => TEST_DIRECTORIES.has(part));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Each source file under `root`, once, by the first path that reaches it; a link to a directory already visited is not followed again. */
function sourceFiles(root: string): string[] {
  const visited = new Set<string>();
  const found = new Map<string, string>();
  const visit = (directory: string): void => {
    const realDirectory = realpathSync(directory);
    if (visited.has(realDirectory)) return;
    visited.add(realDirectory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(path))) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) visit(path);
      } else if (
        (entry.isFile() || (entry.isSymbolicLink() && isFile(path))) &&
        SOURCE_FILE.test(entry.name) &&
        !entry.name.endsWith('.d.ts')
      ) {
        const realFile = realpathSync(path);
        if (!found.has(realFile)) found.set(realFile, path);
      }
    }
  };
  visit(root);
  return [...found.values()];
}

function loadTypeScript(root: string, explicit: string | undefined): typeof TS | undefined {
  const require = createRequire(join(root, 'package.json'));
  try {
    return require(explicit ?? 'typescript');
  } catch {
    return undefined;
  }
}

const USAGE =
  'Usage: node contract-from-json.ts [project-root] [--typescript <path to the typescript package>]';

function parseArgs(args: readonly string[]): {
  readonly root: string;
  readonly typescript: string | undefined;
  readonly errors: string[];
} {
  const errors: string[] = [];
  const positional: string[] = [];
  let typescript: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (arg === '--typescript') {
      const path = args[++index];
      if (path === undefined || path.startsWith('-'))
        errors.push('--typescript: needs the path to the typescript package');
      else typescript = resolve(path);
    } else if (arg.startsWith('-')) errors.push(`${arg}: unknown option`);
    else positional.push(arg);
  }
  if (positional.length > 1) errors.push(`expected one project root, got ${positional.length}`);
  const root = resolve(positional[0] ?? process.cwd());
  if (errors.length === 0 && !isDirectory(root)) errors.push(`${root}: not a directory`);
  if (errors.length > 0) errors.push(USAGE);
  return { root, typescript, errors };
}

function main(): number {
  const { root, typescript, errors } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    return 1;
  }
  const ts = loadTypeScript(root, typescript);
  if (ts === undefined) {
    process.stderr.write(
      `TypeScript is not installed in ${root}. Install it (for example pnpm add -D typescript) and run the script again, or move each client by hand as the guide describes. No file was changed.\n`,
    );
    return 1;
  }

  let refused = 0;
  for (const path of sourceFiles(root).sort()) {
    const name = relative(root, path).split('\\').join('/');
    const source = readFileSync(path, 'utf8');
    const outcome: Outcome = isTestPath(name)
      ? DETECTION.test(source)
        ? {
            kind: 'refused',
            reason:
              'it is a test file; import the contract value from the module that creates the client',
          }
        : { kind: 'unchanged' }
      : moveFile(ts, path, source);
    if (outcome.kind === 'rewritten') {
      writeFileSync(path, outcome.source);
      process.stdout.write(
        outcome.exported
          ? `${name}: moved to contractFromJson\n`
          : `${name}: moved to contractFromJson; contract is not exported, because the module has a default export (a Worker treats every named export of its entry module as an entrypoint); a module that needs the value gets it from a separate module\n`,
      );
    } else if (outcome.kind === 'refused') {
      refused++;
      process.stderr.write(`${name}: not moved, because ${outcome.reason}\n`);
    }
  }
  return refused === 0 ? 0 : 1;
}

process.exitCode = main();
