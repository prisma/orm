// The fingerprint a record in api-breaks.json carries (records.mjs): of an export's lines in its
// package's api.txt, and of the lines of every declaration in that api.txt those lines use as a
// type, followed until nothing new is used. Each line is read with TypeScript's own scanner, as
// flatten.mjs writes it, so string and template literals are found exactly; it lives apart from
// records.mjs, which the pull request check imports without installing anything.

import { createHash } from 'node:crypto';
import ts from 'typescript';
import { compareCodeUnits, exportOfLine } from './api-lines.mjs';

const K = ts.SyntaxKind;
const NAME = /^[A-Za-z_$][\w$]*$/;
const PREFIX = /^(\.[^:]*: |\(not exported\) )/;
const DECLARED =
  /^(?:(?:abstract|declare|async)\s+)*(?:class|interface|type|function\*?|const|let|var|enum|namespace)\s+([A-Za-z_$][\w$]*)/;

// What api.txt writes around a declaration's types, by position: a forward's package, an
// augmentation's module, a type of another package, and in a member line the member's descriptor
// and name. The declaration's
// own name stays, so that its lines on other import paths are taken in too.
const FORWARD = /^(?:export (?:type )?(\S+)(?: = \S+)?|everything) from \S+$/;
const AUGMENTED_MODULE = /^augments \S+ /;
// A type of another package, which api.txt writes as `@scope/name/path.Type`.
const OTHER_PACKAGE = /@[\w.-]+\/[\w./-]+\.[A-Za-z_$][\w$]*/g;
const MEMBER =
  /^((?:abstract )?class [\w$]+|interface [\w$]+|enum [\w$]+|namespace [\w$]+), (?:(?:abstract|static|protected|private|public|readonly) )*(?:(?:required|optional) (?:property|method) (?:[\w$]+|'[^']*'|"[^"]*")|(?:index|call|construct) signature|constructor)/;

const declarationOf = (line) => line.replace(PREFIX, '').replace(/^deprecated: /, '');

// The part of a line that holds types: what api.txt writes around them, by position, left out.
function typeText(line) {
  const declaration = declarationOf(line);
  const forward = FORWARD.exec(declaration);
  if (forward) return forward[1] ?? '';
  return declaration
    .replace(AUGMENTED_MODULE, '')
    .replace(MEMBER, '$1, ')
    .replace(OTHER_PACKAGE, ' ');
}

// The tokens of a text, with each template literal's `${…}` parts read as code.
function tokensOf(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens = [];
  const spans = [];
  for (let kind = scanner.scan(); kind !== K.EndOfFileToken; kind = scanner.scan()) {
    if (kind === K.TemplateHead) spans.push(0);
    else if (kind === K.OpenBraceToken && spans.length > 0) spans[spans.length - 1]++;
    else if (kind === K.CloseBraceToken && spans.length > 0) {
      if (spans.at(-1) === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === K.TemplateTail) spans.pop();
      } else spans[spans.length - 1]--;
    }
    tokens.push({ kind, text: scanner.getTokenText() });
  }
  return tokens;
}

// The tokens after which a word followed by `:` is a member's or a parameter's name.
const NAME_FOLLOWS = new Set([
  K.OpenParenToken,
  K.CommaToken,
  K.OpenBraceToken,
  K.SemicolonToken,
  K.OpenBracketToken,
  K.DotDotDotToken,
  K.ReadonlyKeyword,
  K.StaticKeyword,
  K.ProtectedKeyword,
  K.PrivateKeyword,
  K.PublicKeyword,
  K.AbstractKeyword,
]);

// A reserved word, `default` among them, never names a declaration; a contextual one can.
const isWord = ({ kind, text }) =>
  (kind === K.Identifier ||
    (kind >= K.FirstKeyword &&
      kind <= K.LastKeyword &&
      !(kind >= K.FirstReservedWord && kind <= K.LastReservedWord))) &&
  NAME.test(text);

// The words a line uses that may name a declaration. A word TypeScript also uses, such as `type`
// or `index`, counts too: it is followed only when the package declares that name.
function usedNames(line) {
  const tokens = tokensOf(typeText(line));
  return tokens
    .filter((token, index) => {
      if (!isWord(token)) return false;
      const next = tokens[index + 1];
      const labels =
        next?.kind === K.ColonToken ||
        (next?.kind === K.QuestionToken && tokens[index + 2]?.kind === K.ColonToken);
      return !(labels && (index === 0 || NAME_FOLLOWS.has(tokens[index - 1].kind)));
    })
    .map(({ text }) => text);
}

const linesByOwner = new Map();

// The lines of an api.txt, by the names other lines use for the declaration each belongs to, on
// any path or not exported: its own name, and for a default export or an augmentation also the
// name it is declared with.
function ownersOf(apiText) {
  if (!linesByOwner.has(apiText)) {
    const owners = new Map();
    const add = (name, owner) => owners.set(name, [...(owners.get(name) ?? []), owner]);
    for (const line of apiText.split(/\r?\n/)) {
      if (line === '' || line.startsWith('#')) continue;
      const owner = { line, ...exportOfLine(line) };
      add(owner.name, owner);
      const declaration = declarationOf(line);
      const defaulted = /^export (?:type )?default = (.*)$/.exec(declaration)?.[1];
      const declared = defaulted && DECLARED.exec(defaulted)?.[1];
      if (declared) add(declared, owner);
      const augmented = /^augments \S+ interface ([A-Za-z_$][\w$]*)/.exec(declaration)?.[1];
      if (augmented) add(augmented, owner);
    }
    linesByOwner.set(apiText, owners);
  }
  return linesByOwner.get(apiText);
}

// The lines a fingerprint takes in: an export's lines (for `*`, every line of the import path) and
// those of every declaration of the same api.txt they use as a type, followed until nothing new is
// used. A type of another package is not in the api.txt, so a change to it is not seen.
export function fingerprintLines(apiText, path, name) {
  const owners = ownersOf(apiText ?? '');
  const taken = new Set();
  const followed = new Set();
  const queue = [...owners.values()]
    .flat()
    .filter((owner) => owner.subpath === path && (name === '*' || owner.name === name));
  while (queue.length > 0) {
    const { line } = queue.pop();
    if (taken.has(line)) continue;
    taken.add(line);
    for (const word of usedNames(line)) {
      if (followed.has(word)) continue;
      followed.add(word);
      queue.push(...(owners.get(word) ?? []));
    }
  }
  return [...taken].sort(compareCodeUnits);
}

export const apiFingerprint = (apiText, path, name) =>
  createHash('sha256')
    .update(fingerprintLines(apiText, path, name).join('\n'))
    .digest('hex')
    .slice(0, 16);
