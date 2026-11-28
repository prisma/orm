// Fails when a published package exports a set of values that user code may handle case by case,
// and the set is neither open nor declared. Open means its type carries a catch-all member, so a
// `never` exhaustiveness check over it cannot compile and a later release may add a value.
// Declared means packages/9-public/value-sets.json lists it, with a status and a reason. The
// policy is in docs/Public API Compatibility.md, under "Sets of values". Only Node built-ins.
//
// A set is a type alias in an api.txt whose members are all literals, or all declarations with a
// `kind` property, or a property of an exported class or interface whose type is written as a union
// of literals, which is named `Type.property`. A member may name another such alias of the same package, or be the values of
// a constant (`(typeof X)[number]`, `(typeof X)[keyof typeof X]`). The catch-all member is
// `(string & {})`, `(number & {})` or a template literal `& {}` for literals, and
// `{ readonly kind: '%future added value' }` for declarations, which keeps narrowing on `kind`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCodeUnits } from './api-lines.mjs';

export const DECLARATIONS_FILE = 'packages/9-public/value-sets.json';
export const STATUSES = ['closed', 'not-cases', 'undecided'];

const LIST_FILE = 'api.txt';
const LINE_PREFIX = /^(?:(\.[^:]*): |\(not exported\) )(?:deprecated: )?/;
const ALIAS = /^type ([A-Za-z_$][\w$]*) = (.*)$/;
const CONST = /^const ([A-Za-z_$][\w$]*): (.*)$/;
const TUPLE_ITEM = /^\(typeof ([A-Za-z_$][\w$]*)\)\[number\]$/;
const OBJECT_VALUE = /^\(typeof ([A-Za-z_$][\w$]*)\)\[keyof typeof \1\]$/;
const PROPERTY =
  /^(?:abstract )?(?:class|interface) ([A-Za-z_$][\w$]*), (?:(?:readonly|static|protected|public) )*(?:required|optional) property ([A-Za-z_$][\w$]*)\??: (.*)$/;
const KIND_PROPERTY =
  /^(?:class|interface) ([A-Za-z_$][\w$]*), (?:readonly )?(?:required|optional) property kind\??: /;
const LITERAL = /^(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)$/;
const NAME = /^[A-Za-z_$][\w$]*$/;
const OPEN_LITERALS = /^\(?(?:string|number|`[^`]*`) & \{\s*\}\)?$/;
const OPEN_OBJECTS = /^\{\s*(?:readonly )?kind: (['"])%future added value\1;?\s*\}$/;

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

function readList(text) {
  const aliases = new Map();
  const withKind = new Set();
  const consts = new Map();
  const properties = new Map();
  for (const line of text.split('\n')) {
    const prefix = LINE_PREFIX.exec(line);
    if (!prefix) continue;
    const declaration = line.slice(prefix[0].length);
    const path = prefix[1];
    const kind = KIND_PROPERTY.exec(declaration);
    if (kind) withKind.add(kind[1]);
    const constant = CONST.exec(declaration);
    if (constant) consts.set(constant[1], constant[2]);
    const property = PROPERTY.exec(declaration);
    if (property && path !== undefined) {
      const members = splitTopLevel(property[3], '|').filter((member) => member !== 'undefined');
      if (members.length > 1 && members.some((member) => LITERAL.test(member))) {
        const name = `${property[1]}.${property[2]}`;
        const entry = properties.get(name) ?? { members, paths: [] };
        if (!entry.paths.includes(path)) entry.paths.push(path);
        properties.set(name, entry);
      }
    }
    const alias = ALIAS.exec(declaration);
    if (!alias) continue;
    const [, name, body] = alias;
    const entry = aliases.get(name) ?? { members: splitTopLevel(body, '|'), paths: [] };
    if (path !== undefined && !entry.paths.includes(path)) entry.paths.push(path);
    aliases.set(name, entry);
  }
  return { aliases, withKind, consts, properties };
}

function shapeOf(name, list, seen = new Set()) {
  const alias = list.aliases.get(name);
  if (alias === undefined) {
    return list.withKind.has(name) ? { shape: 'objects', open: false, values: 1 } : {};
  }
  if (seen.has(name)) return {};
  seen.add(name);
  return shapeOfMembers(alias.members, list, seen);
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
    } else if (OPEN_OBJECTS.test(member)) {
      shapes.add('objects');
      open = true;
    } else if (TUPLE_ITEM.test(member) || OBJECT_VALUE.test(member)) {
      const items = constValues(member, list);
      if (items === undefined || !items.every((item) => LITERAL.test(item))) return {};
      shapes.add('literals');
      values += items.length;
    } else if (NAME.test(member)) {
      const inner = shapeOf(member, list, seen);
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
  const type = list.consts.get((tuple ?? OBJECT_VALUE.exec(member))[1]);
  if (type === undefined) return undefined;
  if (tuple) {
    const items = /^readonly \[(.*)\]$/.exec(type);
    return items && splitTopLevel(items[1], ',');
  }
  const properties = /^\{(.*)\}$/.exec(type);
  return (
    properties &&
    splitTopLevel(properties[1], ';').map((property) =>
      property.replace(/^(?:readonly )?[\w$]+\??: /, ''),
    )
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

export function checkValueSets(lists, declarations) {
  const problems = [];
  const exported = new Map();
  for (const { package: pkg, text } of lists) {
    for (const set of findValueSets(text)) exported.set(`${pkg}: ${set.name}`, set);
  }
  const declared = new Set();
  for (const declaration of declarations) {
    const key = `${declaration.package}: ${declaration.type}`;
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
    const set = exported.get(key);
    if (set === undefined) {
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
      `${key} (${set.paths.join(', ')}) is neither open nor declared: add ${set.shape === 'literals' ? '`(string & {})`' : "`{ readonly kind: '%future added value' }`"} to its type, or list it in ${DECLARATIONS_FILE} with its reason`,
    );
  }
  return problems;
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
  const problems = checkValueSets(lists, readDeclarations(join(root, DECLARATIONS_FILE)));
  for (const problem of problems) stderr.write(`${problem}\n`);
  if (problems.length > 0) return 1;
  const count = lists.reduce((sum, { text }) => sum + findValueSets(text).length, 0);
  stdout.write(`${count} exported sets of values, each open or declared\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main({ root: join(fileURLToPath(import.meta.url), '..', '..', '..') });
}
