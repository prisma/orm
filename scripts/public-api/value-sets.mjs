// Fails when a published package exports a set of values that user code may handle case by case,
// and the set is neither open nor declared. Open means its type carries a catch-all member, so a
// `never` exhaustiveness check over it cannot compile and a later release may add a value.
// Declared means packages/9-public/value-sets.json lists it with a status and a reason. The
// policy is in docs/Public API Compatibility.md, under "Sets of values". Only Node built-ins.
//
// A set is a type alias, generic or not, whose members are all literals or all objects told apart
// by a literal `kind` (a declaration with a `kind` property, or an object type written inline), or
// a property of an exported class or interface whose type is written as a union of literals, named
// `Type.property`. A member may name another such alias of the same package, or be the values or
// keys of a constant (`(typeof X)[number]`, `(typeof X)[keyof typeof X]`, `keyof typeof X`).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCodeUnits } from './api-lines.mjs';

export const DECLARATIONS_FILE = 'packages/9-public/value-sets.json';
export const STATUSES = ['closed', 'input', 'type-parameter', 'pending'];
export const RECOMMENDATIONS = ['open', 'closed', 'input', 'type-parameter'];

// The public packages whose import paths are built from packages/1-framework, by their tsdown
// configs; @prisma/orm-framework also publishes two paths built from packages/3-targets/0-shared.
const FRAMEWORK_DOMAIN = {
  '@prisma/orm-toolchain': () => true,
  '@prisma/orm-framework': (path) =>
    !path.startsWith('./type-implementations') && !path.startsWith('./target-package-config'),
};

const LIST_FILE = 'api.txt';
const LINE_PREFIX = /^(?:(\.[^:]*): |\(not exported\) )(?:deprecated: )?/;
const CONST = /^const ([A-Za-z_$][\w$]*): (.*)$/;
const TUPLE_ITEM = /^\(typeof ([A-Za-z_$][\w$]*)\)\[number\]$/;
const OBJECT_VALUE = /^\(typeof ([A-Za-z_$][\w$]*)\)\[keyof typeof \1\]$/;
const OBJECT_KEY = /^keyof typeof ([A-Za-z_$][\w$]*)$/;
const GENERIC_NAME = /^([A-Za-z_$][\w$]*)<.*>$/s;
const KIND_MEMBER = /^(?:readonly )?kind\??: (.*)$/;
const PROPERTY =
  /^(?:abstract )?(?:class|interface) ([A-Za-z_$][\w$]*), (?:(?:readonly|static|protected|public) )*(?:required|optional) property ([A-Za-z_$][\w$]*)\??: (.*)$/;
const KIND_PROPERTY =
  /^(?:class|interface) ([A-Za-z_$][\w$]*), (?:readonly )?(?:required|optional) property kind\??: (.*)$/;
const LITERAL = /^(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)$/;
const NAME = /^[A-Za-z_$][\w$]*$/;
const OPEN_LITERALS = /^\(?(?:string|number|`[^`]*\$\{(?:string|number)\}[^`]*`) & \{\s*\}\)?$/;
const SENTINEL = /^(['"])%future added value\1$/;

function splitTopLevel(text, separator) {
  const members = [];
  let depth = 0;
  let quote;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if ('<([{'.includes(char)) depth++;
    else if ('>)]}'.includes(char) && text[i - 1] !== '=') depth--;
    else if (char === separator && depth === 0) {
      members.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  members.push(text.slice(start).trim());
  return members.filter((member) => member !== '');
}

function aliasOf(declaration) {
  const head = /^type ([A-Za-z_$][\w$]*)/.exec(declaration);
  if (!head) return undefined;
  let rest = declaration.slice(head[0].length);
  if (rest.startsWith('<')) {
    let depth = 0;
    let end = 0;
    for (; end < rest.length; end++) {
      if (rest[end] === '<') depth++;
      else if (rest[end] === '>' && rest[end - 1] !== '=' && --depth === 0) break;
    }
    rest = rest.slice(end + 1);
  }
  return rest.startsWith(' = ') ? [head[1], rest.slice(3)] : undefined;
}

function unwrapped(member) {
  const inner = member.slice(1, -1);
  return member.startsWith('(') && member.endsWith(')') && splitTopLevel(inner, '|').length === 1
    ? inner.trim()
    : member;
}

function inlineKinds(member) {
  for (const part of splitTopLevel(unwrapped(member), '&')) {
    if (!part.startsWith('{') || !part.endsWith('}')) continue;
    for (const property of splitTopLevel(part.slice(1, -1), ';')) {
      const kind = KIND_MEMBER.exec(property);
      const values = kind && splitTopLevel(kind[1], '|');
      if (values?.every((value) => LITERAL.test(value))) return values;
    }
  }
  return undefined;
}

function readList(text) {
  const aliases = new Map();
  const withKind = new Map();
  const consts = new Map();
  const properties = new Map();
  for (const line of text.split('\n')) {
    const prefix = LINE_PREFIX.exec(line);
    if (!prefix) continue;
    const declaration = line.slice(prefix[0].length);
    const path = prefix[1];
    const kind = KIND_PROPERTY.exec(declaration);
    if (kind) withKind.set(kind[1], splitTopLevel(kind[2], '|'));
    const constant = CONST.exec(declaration);
    if (constant) consts.set(constant[1], constant[2]);
    const property = PROPERTY.exec(declaration);
    if (property && path !== undefined) {
      const members = splitTopLevel(property[3], '|').filter(
        (member) => member !== 'undefined' && member !== 'null',
      );
      if (members.length > 1 && members.some((member) => LITERAL.test(member))) {
        const name = `${property[1]}.${property[2]}`;
        const entry = properties.get(name) ?? { members, paths: [] };
        if (!entry.paths.includes(path)) entry.paths.push(path);
        properties.set(name, entry);
      }
    }
    const alias = aliasOf(declaration);
    if (!alias) continue;
    const [name, body] = alias;
    const members = splitTopLevel(body, '|').filter(
      (member) => member !== 'undefined' && member !== 'null',
    );
    const entry = aliases.get(name) ?? { members, paths: [] };
    if (path !== undefined && !entry.paths.includes(path)) entry.paths.push(path);
    aliases.set(name, entry);
  }
  return { aliases, withKind, consts, properties };
}

function shapeOf(name, list, seen = new Set()) {
  const alias = list.aliases.get(name);
  if (alias === undefined) {
    const kinds = list.withKind.get(name);
    if (kinds === undefined || seen.has(name)) return {};
    let open = false;
    let values = 0;
    for (const kind of kinds) {
      if (SENTINEL.test(kind)) open = true;
      else if (LITERAL.test(kind)) values++;
      else {
        const inner = NAME.test(kind) ? shapeOf(kind, list, new Set([...seen, name])) : {};
        if (inner.shape !== 'literals') return {};
        values += inner.values;
      }
    }
    return { shape: 'objects', open, values };
  }
  if (seen.has(name)) return {};
  return shapeOfMembers(alias.members, list, new Set([...seen, name]));
}

function shapeOfMembers(members, list, seen) {
  const shapes = new Set();
  let open = false;
  let values = 0;
  for (const member of members) {
    if (LITERAL.test(member)) {
      shapes.add('literals');
      values++;
    } else if (OPEN_LITERALS.test(member)) {
      shapes.add('literals');
      open = true;
    } else if (inlineKinds(member) !== undefined) {
      shapes.add('objects');
      for (const kind of inlineKinds(member)) {
        if (SENTINEL.test(kind)) open = true;
        else values++;
      }
    } else if (TUPLE_ITEM.test(member) || OBJECT_VALUE.test(member) || OBJECT_KEY.test(member)) {
      const items = constValues(member, list);
      if (items === undefined || !items.every((item) => LITERAL.test(item))) return {};
      shapes.add('literals');
      values += items.length;
    } else if (NAME.test(member) || GENERIC_NAME.test(member)) {
      const inner = shapeOf(GENERIC_NAME.exec(member)?.[1] ?? member, list, seen);
      if (inner.shape === undefined) return {};
      shapes.add(inner.shape);
      open ||= inner.open;
      values += inner.values;
    } else return {};
  }
  if (shapes.size !== 1) return {};
  const [shape] = shapes;
  return { shape, open, values };
}

function constValues(member, list) {
  const tuple = TUPLE_ITEM.exec(member);
  const key = OBJECT_KEY.exec(member);
  const type = list.consts.get((tuple ?? key ?? OBJECT_VALUE.exec(member))[1]);
  if (type === undefined) return undefined;
  if (tuple) {
    const items = /^readonly \[(.*)\]$/.exec(type);
    return items ? splitTopLevel(items[1], ',') : undefined;
  }
  const properties = /^\{(.*)\}$/.exec(type);
  if (!properties) return undefined;
  return splitTopLevel(properties[1], ';').map((property) =>
    key
      ? `'${/^(?:readonly )?([\w$]+)\??: /.exec(property)?.[1]}'`
      : property.replace(/^(?:readonly )?[\w$]+\??: /, ''),
  );
}

export function findValueSets(text) {
  const list = readList(text);
  const sets = [];
  for (const [name, { paths }] of list.aliases) {
    if (paths.length === 0) continue;
    const { shape, open, values } = shapeOf(name, list);
    if (shape === undefined || (values < 2 && !open)) continue;
    sets.push({ name, shape, open, paths: [...paths].sort(compareCodeUnits) });
  }
  for (const [name, { members, paths }] of list.properties) {
    const { shape, open } = shapeOfMembers(members, list, new Set());
    if (shape !== 'literals') continue;
    sets.push({ name, shape, open, paths: [...paths].sort(compareCodeUnits) });
  }
  return sets.sort((a, b) => compareCodeUnits(a.name, b.name));
}

export function checkValueSets(lists, declarations, { version } = {}) {
  const problems = [];
  const exported = new Map();
  for (const { package: pkg, text } of lists) {
    for (const set of findValueSets(text)) exported.set(`${pkg}: ${set.name}`, set);
  }
  const declared = new Set();
  for (const declaration of declarations) {
    const key = `${declaration.package}: ${declaration.type}`;
    if (declared.has(key)) {
      problems.push(`${key} is declared twice in ${DECLARATIONS_FILE}: keep one entry`);
      continue;
    }
    declared.add(key);
    if (!STATUSES.includes(declaration.status)) {
      problems.push(
        `${key}: status "${declaration.status}" is not one of ${STATUSES.join(', ')}, in ${DECLARATIONS_FILE}`,
      );
      continue;
    }
    if (typeof declaration.reason !== 'string' || declaration.reason.trim() === '') {
      problems.push(`${key}: the declaration needs a reason, in ${DECLARATIONS_FILE}`);
      continue;
    }
    if (declaration.status === 'pending' && !RECOMMENDATIONS.includes(declaration.recommended)) {
      problems.push(
        `${key}: a pending declaration needs "recommended", one of ${RECOMMENDATIONS.join(', ')}, in ${DECLARATIONS_FILE}`,
      );
      continue;
    }
    if (declaration.status !== 'pending' && declaration.recommended !== undefined) {
      problems.push(
        `${key}: only a pending declaration has "recommended", in ${DECLARATIONS_FILE}`,
      );
      continue;
    }
    if (declaration.status === 'pending' && version !== undefined && !version.includes('-')) {
      problems.push(
        `${key} is pending, but ${version} is not a prerelease: decide it before the release`,
      );
      continue;
    }
    const set = exported.get(key);
    if (
      set !== undefined &&
      declaration.status === 'pending' &&
      !inFrameworkDomain(declaration.package, set)
    ) {
      problems.push(
        `${key} is pending, but it is not in the framework domain: decide it as ${STATUSES.filter((status) => status !== 'pending').join(', ')} or open`,
      );
    } else if (set === undefined) {
      problems.push(
        `${declaration.type} is declared ${declaration.status} in ${DECLARATIONS_FILE}, but ${declaration.package} exports no such set: remove the entry`,
      );
    } else if (set.open) {
      problems.push(
        `${key} carries the catch-all member, so it is open: remove its entry from ${DECLARATIONS_FILE}`,
      );
    }
  }
  for (const [key, set] of exported) {
    if (set.open || declared.has(key)) continue;
    problems.push(
      `${key} (${set.paths.join(', ')}) is neither open nor declared: add ${set.shape === 'literals' ? '`(string & {})`' : "`{ readonly kind: '%future added value' }`"} to its type, or list it in ${DECLARATIONS_FILE} as ${STATUSES.join(', ')}, with its reason`,
    );
  }
  return problems;
}

function inFrameworkDomain(pkg, set) {
  const domain = FRAMEWORK_DOMAIN[pkg];
  return domain !== undefined && set.paths.every(domain);
}

export function readPublishedLists(root) {
  const scope = join(root, 'packages', '9-public', '@prisma');
  const lists = [];
  for (const folder of readdirSync(scope).sort(compareCodeUnits)) {
    let text;
    try {
      text = readFileSync(join(scope, folder, LIST_FILE), 'utf8');
    } catch {
      continue;
    }
    lists.push({ package: `@prisma/${folder}`, text });
  }
  return lists;
}

export function readDeclarations(file) {
  return JSON.parse(readFileSync(file, 'utf8')).sets;
}

export function main({ root, stdout = process.stdout, stderr = process.stderr }) {
  const lists = readPublishedLists(root);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const problems = checkValueSets(lists, readDeclarations(join(root, DECLARATIONS_FILE)), {
    version,
  });
  for (const problem of problems) stderr.write(`${problem}\n`);
  if (problems.length > 0) return 1;
  const count = lists.reduce((sum, { text }) => sum + findValueSets(text).length, 0);
  stdout.write(`${count} exported sets of values, each open or declared\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main({ root: join(fileURLToPath(import.meta.url), '..', '..', '..') });
}
