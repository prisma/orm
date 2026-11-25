// The committed records of failures accepted against the last release, in three files:
//
// - api-breaks.json beside a package's api.txt: a break the type tests find, as { "path", "export",
//   "test", "kind", "lastRelease", "fingerprint", "reason" }. The fingerprint is of the export's
//   lines in that api.txt and of the declarations they name (apiFingerprint), so the record covers
//   the break only while the export, and what it depends on in its package, stay as recorded; any
//   further change is judged again.
// - packages/9-public/removed-packages.json: a released package the repository no longer has, as
//   { "package", "lastRelease", "reason" }. A removed package is always a break.
// - examples/last-release-errors.json: an error in a last release's example app, as { "app",
//   "file", "line", "code", "message", "kind", "lastRelease", "reason" }. The tag's files never
//   change, so its line and message identify the error.
//
// `kind` is `allowed` for a change the compatibility policy allows that a check reports anyway,
// and `break` for a deliberate break, which the release notes must name. `lastRelease` is the
// release the failure is measured against: a record for an earlier one is skipped and listed as
// removable, one for a later one fails the run. Only Node built-ins, so the pull request check
// that holds a write token can use it without installing anything.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { compareCodeUnits, exportOfLine } from './api-lines.mjs';
import { compareVersions, isVersion } from './release.mjs';

export const BREAKS_FILE = 'api-breaks.json';
export const REMOVED_FILE = 'packages/9-public/removed-packages.json';
export const EXAMPLES_FILE = 'examples/last-release-errors.json';
export const KINDS = ['allowed', 'break'];
export const TESTS = ['type', 'value', 'constructor', 'abstract', 'augments', 'exists', 'path'];

export class RecordsError extends Error {}

const nonEmpty = { test: (value) => typeof value === 'string' && value !== '', says: 'a text' };
const oneLine = {
  test: (value) => typeof value === 'string' && value !== '' && !/[\r\n]/.test(value),
  says: 'one line of text',
};
const PLACEHOLDER = '…';
const reason = {
  test: (value) => oneLine.test(value) && value.trim() !== PLACEHOLDER,
  says: `one line of text that says why, in place of the ${PLACEHOLDER} of a printed record`,
};
const oneOf = (values) => ({
  test: (value) => values.includes(value),
  says: `one of ${values.join(', ')}`,
});
const version = {
  test: (value) => typeof value === 'string' && isVersion(value),
  says: 'a version',
};
const fingerprint = {
  test: (value) => typeof value === 'string' && /^[0-9a-f]{16}$/.test(value),
  says: 'the 16-character fingerprint the report prints',
};
const lineNumber = {
  test: (value) => Number.isInteger(value) && value >= 0,
  says: 'a whole number, 0 for an error with no location',
};
const errorCode = {
  test: (value) => typeof value === 'string' && /^TS\d+$/.test(value),
  says: 'a code such as TS2322',
};

const FIELDS = {
  breaks: {
    path: nonEmpty,
    export: nonEmpty,
    test: oneOf(TESTS),
    kind: oneOf(KINDS),
    lastRelease: version,
    fingerprint,
    reason,
  },
  removed: { package: nonEmpty, lastRelease: version, reason },
  examples: {
    app: nonEmpty,
    file: nonEmpty,
    line: lineNumber,
    code: errorCode,
    message: nonEmpty,
    kind: oneOf(KINDS),
    lastRelease: version,
    reason,
  },
};

// The fields of the records of each record file (`breaks`, `removed` or `examples`), in the order
// they are written.
export const RECORD_KEYS = Object.fromEntries(
  Object.entries(FIELDS).map(([recordFile, fields]) => [recordFile, Object.keys(fields)]),
);

export function validateRecords(recordFile, value, label) {
  const fields = FIELDS[recordFile];
  const shape = `Each record is { ${RECORD_KEYS[recordFile].map((key) => `"${key}"`).join(', ')} }.`;
  if (!Array.isArray(value))
    throw new RecordsError(`${label}: is not a JSON array of records. ${shape}`);
  value.forEach((record, index) => {
    const where = `${label}: record ${index + 1}`;
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new RecordsError(`${where} is not an object. ${shape}`);
    }
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(fields, key))
        throw new RecordsError(`${where} has a field ${key}, which records do not have. ${shape}`);
    }
    for (const [key, field] of Object.entries(fields)) {
      if (!field.test(record[key]))
        throw new RecordsError(`${where}: ${key} must be ${field.says}. ${shape}`);
    }
  });
  return value;
}

export function readRecords(file, recordFile, label = file) {
  if (!existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new RecordsError(`${label}: ${error.message}`);
  }
  return validateRecords(recordFile, parsed, label);
}

// Sorts records by the release they are for: the last one, an earlier one (removable), or a later
// one, which is a problem.
export function byLastRelease(records, version, describe) {
  const current = [];
  const removable = [];
  const problems = [];
  for (const record of records) {
    const order = compareVersions(record.lastRelease, version);
    if (order < 0) removable.push(record);
    else if (order > 0) {
      problems.push(
        `${describe(record)}: the record is for the last release ${record.lastRelease}, which is later than the last release, ${version}.`,
      );
    } else current.push(record);
  }
  return { current, removable, problems };
}

// The one way an export is written in text: its package and import path, then its name.
export const exportLabel = (packageName, path, name) =>
  path === undefined
    ? `${packageName} (not exported): ${name}`
    : `${packageName}${path === '.' ? '' : path.slice(1)}: ${name}`;

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const NAME = '[A-Za-z_$][\\w$]*';
// Words api.txt writes itself, and TypeScript's own, which never name a declaration of ours.
const NOT_TYPES = new Set(
  `exported deprecated export default from everything augments readonly optional required property
  method protected private public static abstract constructor accessor get set index signature call
  construct declare async class interface type function const let var enum namespace module extends
  implements keyof typeof infer is asserts unique new this in out as of`.split(/\s+/),
);
const DECLARED = new RegExp(
  `^(?:(?:abstract|declare|async)\\s+)*(?:class|interface|type|function\\*?|const|let|var|enum|namespace)\\s+(${NAME})`,
);

// The names a line uses as types: its prefix, string literals (but not the `${…}` parts of a
// template literal), package specifiers, member, property and parameter names, and api.txt's
// own words are left out.
function typeNames(line) {
  let rest = line.replace(/^(\.[^:]*: |\(not exported\) )/, '').replace(/^deprecated: /, '');
  rest = rest.replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, (text) =>
    (text.match(/\$\{[^}]*\}/g) ?? []).join(' '),
  );
  rest = rest.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ' ');
  rest = rest.replace(/@[\w.-]+\/[\w./-]+/g, ' ');
  rest = rest.replace(new RegExp(`\\b(property|method|accessor) ${NAME}`, 'g'), ' ');
  rest = rest.replace(
    new RegExp(
      `(^|[(,{;[]\\s*|\\b(?:readonly|static|protected|private|public|abstract)\\s+|\\.\\.\\.)(${NAME})(?=\\??\\s*:)`,
      'g',
    ),
    '$1',
  );
  return [...rest.matchAll(IDENTIFIER)]
    .map(([word]) => word)
    .filter((word) => !NOT_TYPES.has(word));
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
      const declaration = line
        .replace(/^(\.[^:]*: |\(not exported\) )/, '')
        .replace(/^deprecated: /, '');
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

// The lines a fingerprint takes in: an export's lines in an api.txt, its member lines included
// (for `*`, every line of the import path), and the lines of every declaration in the same api.txt
// those lines name as a type, followed until nothing new is named. A type of another package is
// not in the api.txt, so a change to it does not change the fingerprint.
export function fingerprintLines(apiText, path, name) {
  const owners = ownersOf(apiText ?? '');
  const taken = new Set();
  const queue = [...owners.values()]
    .flat()
    .filter((owner) => owner.subpath === path && (name === '*' || owner.name === name));
  const named = new Set();
  while (queue.length > 0) {
    const { line } = queue.pop();
    if (taken.has(line)) continue;
    taken.add(line);
    for (const word of typeNames(line)) {
      if (named.has(word)) continue;
      named.add(word);
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

// One line of JSON per record, its fields in the documented order.
export function recordLine(record, recordFile) {
  if (record === null || typeof record !== 'object') return JSON.stringify(record);
  const keys = RECORD_KEYS[recordFile];
  const ordered = [
    ...keys.filter((key) => Object.hasOwn(record, key)),
    ...Object.keys(record)
      .filter((key) => !keys.includes(key))
      .sort(compareCodeUnits),
  ];
  return JSON.stringify(Object.fromEntries(ordered.map((key) => [key, record[key]])));
}

// A TypeScript message as reports print it and records hold it: `import("…")` qualifiers, which
// name files with build hashes and install folders, are left out.
const QUALIFIER = /import\("[^"]*"(?:, \{[^)]*\})?\)/g;

export const normaliseMessage = (message) =>
  message.replace(new RegExp(`${QUALIFIER.source}\\.`, 'g'), '').replace(QUALIFIER, 'import(…)');
