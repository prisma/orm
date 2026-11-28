// Lists the lines a pull request adds to and removes from the packages' api.txt files, and the
// records it adds to and removes from the four record files (scripts/public-api/records.mjs). Keeps
// one comment with that list current, and fails until the description names each changed export,
// and the package, app or error code of each changed record.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compareCodeUnits, exportOfLine } from '../../../scripts/public-api/api-lines.mjs';
import {
  BREAKS_FILE,
  EXAMPLES_FILE,
  exportLabel,
  REMOVED_CODES_FILE,
  REMOVED_PACKAGES_FILE,
  recordLine,
} from '../../../scripts/public-api/records.mjs';

export class ApiChangesError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const MARKER = '<!-- api-changes -->';
export const SECTION = '## API changes';
const PACKAGE_FILE = /^packages\/9-public\/(@prisma\/[^/]+)\/(api\.txt|api-breaks\.json)$/;
const COMMENT_LIMIT = 60_000;
export const SUMMARY_BYTES = 1_000_000;
const SUMMARY_MARGIN = 1_000;
const BASE = 'HEAD^1';
const HEAD = 'HEAD';
const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;

function linesOf(text) {
  if (text === undefined) return new Set();
  return new Set(text.split(/\r?\n/).filter((line) => line !== '' && !line.startsWith('#')));
}

export function apiChanges(files) {
  const changes = [];
  for (const file of files) {
    if (file.source === 'breaks') changes.push(...breakChanges(file));
    else if (file.source === 'examples') changes.push(...exampleChanges(file));
    else if (file.source === 'removedPackages')
      changes.push(...removedChanges(file, REMOVED_PACKAGES));
    else if (file.source === 'removedCodes') changes.push(...removedChanges(file, REMOVED_CODES));
    else changes.push(...listChanges(file));
  }
  return changes;
}

function difference(before, after) {
  const added = [...after].filter((line) => !before.has(line)).sort(compareCodeUnits);
  const removed = [...before].filter((line) => !after.has(line)).sort(compareCodeUnits);
  return { added, removed };
}

function listChanges({ packageName, before, after }) {
  const { added, removed } = difference(linesOf(before), linesOf(after));
  if (added.length === 0 && removed.length === 0) return [];
  const exports = new Set(
    [...added, ...removed].map((line) => {
      const { subpath, name } = exportOfLine(line);
      return exportLabel(packageName, subpath, name);
    }),
  );
  return [{ packageName, added, removed, exports: [...exports].sort(compareCodeUnits) }];
}

function recordsOf(text, file) {
  if (text === undefined) return [];
  let records;
  try {
    records = JSON.parse(text);
  } catch (error) {
    throw new ApiChangesError(`${file}: ${error.message}`);
  }
  if (!Array.isArray(records)) throw new ApiChangesError(`${file}: is not a JSON array of records`);
  return records;
}

function breakChanges({ packageName, before, after }) {
  const heading = `packages/9-public/${packageName}/${BREAKS_FILE}`;
  const lines = (text) =>
    new Set(recordsOf(text, heading).map((record) => recordLine(record, 'breaks')));
  const { added, removed } = difference(lines(before), lines(after));
  if (added.length === 0 && removed.length === 0) return [];
  return [{ packageName, heading, added, removed, exports: [packageName] }];
}

function exampleChanges({ before, after }) {
  const byApp = (text) => {
    const apps = new Map();
    for (const record of recordsOf(text, EXAMPLES_FILE)) {
      const app = typeof record?.app === 'string' ? record.app : undefined;
      if (!apps.has(app)) apps.set(app, new Set());
      apps.get(app).add(recordLine(record, 'examples'));
    }
    return apps;
  };
  const old = byApp(before);
  const current = byApp(after);
  const apps = [...new Set([...old.keys(), ...current.keys()])].sort((a, b) =>
    compareCodeUnits(a ?? '', b ?? ''),
  );
  return apps.flatMap((app) => {
    const { added, removed } = difference(old.get(app) ?? new Set(), current.get(app) ?? new Set());
    if (added.length === 0 && removed.length === 0) return [];
    const name = app === undefined ? EXAMPLES_FILE : `examples/${app}`;
    const heading = app === undefined ? EXAMPLES_FILE : `${EXAMPLES_FILE}: ${app}`;
    return [{ packageName: name, heading, added, removed, exports: [name] }];
  });
}

const REMOVED_PACKAGES = {
  file: REMOVED_PACKAGES_FILE,
  recordFile: 'removedPackages',
  key: 'package',
  fields: {},
};
const REMOVED_CODES = {
  file: REMOVED_CODES_FILE,
  recordFile: 'removedCodes',
  key: 'code',
  fields: { errorCode: true },
};

// A record of a removed package is named by the package, and one of a removed error code by the
// code.
function removedChanges({ before, after }, { file, recordFile, key, fields }) {
  const byName = (text) => {
    const names = new Map();
    for (const record of recordsOf(text, file)) {
      const name = typeof record?.[key] === 'string' ? record[key] : file;
      if (!names.has(name)) names.set(name, new Set());
      names.get(name).add(recordLine(record, recordFile));
    }
    return names;
  };
  const old = byName(before);
  const current = byName(after);
  return [...new Set([...old.keys(), ...current.keys()])].sort(compareCodeUnits).flatMap((name) => {
    const { added, removed } = difference(
      old.get(name) ?? new Set(),
      current.get(name) ?? new Set(),
    );
    if (added.length === 0 && removed.length === 0) return [];
    return [
      {
        packageName: name,
        heading: `${file}: ${name}`,
        added,
        removed,
        exports: [name],
        ...fields,
      },
    ];
  });
}

export function readChangedFiles({ git }) {
  const status = git([
    'diff',
    '--name-status',
    '--no-renames',
    BASE,
    HEAD,
    '--',
    'packages/9-public/@prisma/*/api.txt',
    `packages/9-public/@prisma/*/${BREAKS_FILE}`,
    EXAMPLES_FILE,
    REMOVED_PACKAGES_FILE,
    REMOVED_CODES_FILE,
  ]);
  const files = [];
  for (const entry of status.split('\n')) {
    const [change, path] = entry.split('\t');
    const found = sourceOf(path ?? '');
    if (found === undefined) continue;
    files.push({
      path,
      source: found.source,
      packageName: found.packageName,
      before: change === 'A' ? undefined : git(['show', `${BASE}:${path}`]),
      after: change === 'D' ? undefined : git(['show', `${HEAD}:${path}`]),
    });
  }
  return files
    .sort((a, b) => compareCodeUnits(a.path, b.path))
    .map(({ path: _path, ...file }) => file);
}

function sourceOf(path) {
  if (path === EXAMPLES_FILE) return { source: 'examples', packageName: undefined };
  if (path === REMOVED_PACKAGES_FILE) return { source: 'removedPackages', packageName: undefined };
  if (path === REMOVED_CODES_FILE) return { source: 'removedCodes', packageName: undefined };
  const match = PACKAGE_FILE.exec(path);
  if (match === null) return undefined;
  return { source: match[2] === 'api.txt' ? 'api' : 'breaks', packageName: match[1] };
}

function outsideFences(lines) {
  let fence;
  return lines.map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === undefined) {
      if (marker !== undefined) fence = marker;
      return marker === undefined;
    }
    if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = undefined;
    }
    return false;
  });
}

function sectionOf(body) {
  const lines = (body ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const prose = outsideFences(lines);
  const start = lines.findIndex(
    (line, i) => prose[i] && /^##\s+API changes\s*#*\s*$/i.test(line.trim()),
  );
  if (start === -1) return undefined;
  const end = lines.findIndex((line, i) => i > start && prose[i] && /^#{1,2}\s/.test(line.trim()));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function codeSpans(line) {
  return [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
}

function hasReason(line) {
  const words = line.replace(/`[^`]*`/g, ' ').match(/\p{L}{2,}/gu) ?? [];
  return words.length >= 2;
}

export function checkDescription(body, groups) {
  const names = groups.flatMap(({ exports }) => exports);
  const section = sectionOf(body);
  if (section === undefined) return { section: false, missing: names, withoutReason: [] };
  const named = new Map();
  for (const line of section) {
    for (const span of codeSpans(line)) {
      named.set(span, (named.get(span) ?? false) || hasReason(line));
    }
  }
  const missing = [];
  const withoutReason = [];
  for (const { packageName, exports } of groups) {
    for (const name of exports) {
      if (named.get(name) === true || named.get(packageName) === true) continue;
      if (named.has(name) || named.has(packageName)) withoutReason.push(name);
      else missing.push(name);
    }
  }
  return { section: true, missing, withoutReason };
}

// One entry per package that has more names than this, so the list fits in a description.
const PACKAGE_ENTRY_THRESHOLD = 50;

function entries(groups, names = new Set(groups.flatMap(({ exports }) => exports))) {
  return groups
    .flatMap(({ packageName, exports }) => {
      const listed = exports.filter((name) => names.has(name));
      if (listed.length > PACKAGE_ENTRY_THRESHOLD) {
        return [`- \`${packageName}\`: (${listed.length} exports)`];
      }
      return listed.map((name) => `- \`${name}\`:`);
    })
    .join('\n');
}

const PACKAGE_FORM =
  'A package name in backticks, on a line with a reason, covers every change in that package.';

const RECORDS_FORM =
  'A change to a package’s api-breaks.json is named by the package, and a change to examples/last-release-errors.json by `examples/<app>`, and a change to packages/9-public/removed-error-codes.json by the error code.';

const isRecord = (change) => change.heading !== undefined;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function failureMessage({ section, missing, withoutReason }, groups) {
  const parts = [
    'This pull request changes the public API, and its description does not yet say why for each change.',
  ];
  if (!section) {
    parts.push(
      `Add a section headed "${SECTION}" to the description. Name each export below in backticks, exactly as written here, on a line that also says why it is added, removed or changed. Several names may share one line and one reason. ${PACKAGE_FORM}`,
    );
  } else if (missing.length > 0) {
    parts.push(`The "${SECTION}" section does not name these exports. ${PACKAGE_FORM}`);
  }
  if (missing.length > 0) parts.push(entries(groups, new Set(missing)));
  if (withoutReason.length > 0) {
    parts.push(
      `These exports are named on a line that gives no reason; write why on the same line:\n${entries(groups, new Set(withoutReason))}`,
    );
  }
  if (groups.some(isRecord)) parts.push(RECORDS_FORM);
  parts.push(
    `For example:\n\n\`\`\`markdown\n${SECTION}\n\n- \`@prisma/orm-postgres/config: defineConfig\`: added so a config file can name the database URL.\n- \`@prisma/orm-framework\`: regenerated after the TypeScript upgrade, no API change.\n\`\`\``,
  );
  return parts.join('\n\n');
}

function fenceFor(lines) {
  const longest = Math.max(
    0,
    ...lines.map((line) => Math.max(0, ...[...line.matchAll(/`+/g)].map((m) => m[0].length))),
  );
  return '`'.repeat(Math.max(3, longest + 1));
}

function diffLines({ added, removed }) {
  return [
    ...added.map((line) => ({ line, text: `+ ${line}` })),
    ...removed.map((line) => ({ line, text: `- ${line}` })),
  ]
    .sort((a, b) => compareCodeUnits(a.line, b.line) || compareCodeUnits(a.text, b.text))
    .map(({ text }) => text);
}

function render(changes, { shown, template, where }) {
  const lists = changes.filter((change) => !isRecord(change)).length;
  const codes = changes.filter((change) => change.errorCode).length;
  const records = changes.length - lists;
  const others = records - codes;
  const subject = [
    lists > 0 ? `the \`api.txt\` list of ${plural(lists, 'package')}` : undefined,
    others > 0
      ? `the recorded breaks or expected example-app errors of ${others === 1 ? 'one package or app' : `${others} packages or apps`}`
      : undefined,
    codes > 0
      ? `the recorded removal of ${codes === 1 ? 'one error code' : `${codes} error codes`}`
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' and ');
  const out = [
    MARKER,
    '## Public API changes',
    '',
    `This pull request changes ${subject}. Its description needs a section headed \`${SECTION}\` that names each export below, in backticks, on a line that says why it changes. ${PACKAGE_FORM}${records > 0 ? ` ${RECORDS_FORM}` : ''}${template ? ' You can start from this:' : ` The names are in the ${where}.`}`,
    '',
  ];
  if (template) out.push('```markdown', SECTION, '', entries(changes), '```', '');
  let left = shown;
  let total = 0;
  for (const change of changes) {
    const lines = diffLines(change);
    total += lines.length;
    const visible = lines.slice(0, Math.max(0, left));
    left -= visible.length;
    if (visible.length === 0) continue;
    const fence = fenceFor(visible);
    out.push(
      `### \`${change.heading ?? change.packageName}\``,
      '',
      `${fence}diff`,
      ...visible,
      fence,
      '',
    );
  }
  const omitted = total - Math.min(shown, total);
  if (omitted > 0) {
    out.push(
      `**${omitted} lines are left out here. The full list is in the ${where} of the "API changes" check.**`,
      '',
    );
  }
  return out.join('\n');
}

const fits = (text, limit) => Buffer.byteLength(text) <= limit;

export function commentBody(
  changes,
  { limit = Number.POSITIVE_INFINITY, where = 'job summary' } = {},
) {
  if (changes.length === 0) {
    return `${MARKER}\n## Public API changes\n\nThis pull request no longer changes any \`api.txt\` list.\n`;
  }
  const total = changes.reduce(
    (sum, change) => sum + change.added.length + change.removed.length,
    0,
  );
  const full = render(changes, { shown: total, template: true, where });
  if (fits(full, limit)) return full;
  const template = fits(render(changes, { shown: 0, template: true, where }), limit);
  let low = 0;
  let high = total;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(render(changes, { shown: middle, template, where }), limit)) low = middle;
    else high = middle - 1;
  }
  return render(changes, { shown: low, template, where });
}

const isOurs = (comment) =>
  comment.user?.login === 'github-actions[bot]' && comment.body?.startsWith(MARKER);

async function findComment({ request, repository, prNumber }) {
  for (let page = 1; ; page++) {
    const comments = await request(
      'GET',
      `/repos/${repository}/issues/${prNumber}/comments?per_page=100&page=${page}`,
    );
    const found = comments.find(isOurs);
    if (found) return found;
    if (comments.length < 100) return undefined;
  }
}

export async function publish({
  comment,
  summary,
  createComment,
  isFork,
  prNumber,
  repository,
  request,
  appendSummary,
  log,
}) {
  if (summary !== undefined) appendSummary(summary);
  if (isFork) {
    log(
      'The pull request comes from a fork, whose token cannot comment; the list is in the job summary.',
    );
    return;
  }
  try {
    const existing = await findComment({ request, repository, prNumber });
    if (existing) {
      if (existing.body !== comment) {
        await request('PATCH', `/repos/${repository}/issues/comments/${existing.id}`, {
          body: comment,
        });
      }
    } else if (createComment) {
      await request('POST', `/repos/${repository}/issues/${prNumber}/comments`, { body: comment });
    }
  } catch (error) {
    log(
      `::warning::Could not post or update the API changes comment (${error.message}); the list is in the job summary.`,
    );
  }
}

export async function run({ event, repository, readFiles, request, appendSummary, log }) {
  const pullRequest = event.pull_request;
  const changes = apiChanges(readFiles());
  const isFork = pullRequest.head.repo?.full_name !== repository;

  for (const change of changes) {
    log(`${change.packageName}:\n${diffLines(change).join('\n')}`);
  }
  if (changes.length > 0) log(`Names for the description:\n${entries(changes)}`);

  const result = checkDescription(pullRequest.body, changes);
  const ok = result.missing.length === 0 && result.withoutReason.length === 0;
  const message = ok ? undefined : failureMessage(result, changes);
  const failure = message === undefined ? '' : `\n## Description check\n\n${message}\n`;
  await publish({
    comment: commentBody(changes, { limit: COMMENT_LIMIT }),
    summary:
      changes.length === 0
        ? undefined
        : `${commentBody(changes, {
            limit: SUMMARY_BYTES - SUMMARY_MARGIN - Buffer.byteLength(failure),
            where: 'job log',
          })}${failure}`,
    createComment: changes.length > 0,
    isFork,
    prNumber: event.number,
    repository,
    request,
    appendSummary,
    log,
  });

  if (changes.length === 0) return { ok: true, message: 'This pull request changes no api.txt.' };
  if (ok) return { ok, message: 'The description names every changed export with a reason.' };
  return { ok, message };
}

function githubRequest(token) {
  return async (method, path, body) => {
    const response = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'api-changes-check',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ApiChangesError(
        `GitHub ${method} ${path} responded ${response.status}: ${await response.text()}`,
        response.status,
      );
    }
    return response.json();
  };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

async function main() {
  const { GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_STEP_SUMMARY, GITHUB_TOKEN } = process.env;
  const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8'));
  const result = await run({
    event,
    repository: GITHUB_REPOSITORY,
    readFiles: () => readChangedFiles({ git }),
    request: githubRequest(GITHUB_TOKEN),
    appendSummary: (text) => appendFileSync(GITHUB_STEP_SUMMARY, `${text}\n`),
    log: (text) => console.log(text),
  });
  if (result.ok) {
    console.log(result.message);
    return;
  }
  console.log(
    `::error title=API changes not named in the description::${result.message.split('\n')[0]}`,
  );
  console.error(result.message);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
