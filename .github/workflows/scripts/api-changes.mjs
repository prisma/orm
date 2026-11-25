// Lists the lines a pull request adds to and removes from the packages' api.txt files, keeps one
// comment with that list current, and fails until the description names each changed export.
// The line format is written by scripts/public-api/flatten.mjs.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export class ApiChangesError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const MARKER = '<!-- api-changes -->';
export const SECTION = '## API changes';
const API_FILE = /^packages\/9-public\/(@prisma\/[^/]+)\/api\.txt$/;
const COMMENT_LIMIT = 60_000;
const SUMMARY_LIMIT = 900_000;
const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;

const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const DECLARATION = new RegExp(
  `^(?:(?:abstract|declare|async)\\s+)*(?:class|interface|type|function\\*?|const|let|var|enum|namespace|module)\\s+(${IDENTIFIER})`,
);
const DEFAULT_EXPORT = /^export (?:type )?default = /;
const TYPE_ONLY_MARKER = 'export type ';
const FORWARD = new RegExp(`^export (?:type )?(${IDENTIFIER})(?: = | from )`);
const STAR_FORWARD = /^everything from \S+$/;
const AUGMENTATION = new RegExp(`^augments \\S+ interface ${IDENTIFIER}`);

export function exportOfLine(line) {
  const exported = /^(\.[^:]*): /.exec(line);
  const subpath = exported?.[1];
  let rest;
  if (exported) rest = line.slice(exported[0].length);
  else if (line.startsWith('(not exported) ')) rest = line.slice('(not exported) '.length);
  else throw new ApiChangesError(`cannot read the api.txt line: ${line}`);
  rest = rest.replace(/^deprecated: /, '');

  const name = nameOf(rest);
  if (name === undefined) {
    throw new ApiChangesError(
      `cannot tell which export the api.txt line belongs to: ${line}\nThe line format in scripts/public-api/flatten.mjs has changed; teach .github/workflows/scripts/api-changes.mjs to read it.`,
    );
  }
  return { subpath, name };
}

function nameOf(rest) {
  if (DEFAULT_EXPORT.test(rest)) return 'default';
  if (STAR_FORWARD.test(rest)) return rest;
  const augmentation = AUGMENTATION.exec(rest);
  if (augmentation) return augmentation[0];
  const declaration = rest.startsWith(TYPE_ONLY_MARKER)
    ? DECLARATION.exec(rest.slice(TYPE_ONLY_MARKER.length))
    : DECLARATION.exec(rest);
  if (declaration) return declaration[1];
  return FORWARD.exec(rest)?.[1];
}

export function exportLabel(packageName, { subpath, name }) {
  if (subpath === undefined) return `${packageName} (not exported): ${name}`;
  return `${packageName}${subpath.slice(1)}: ${name}`;
}

const compareCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function linesOf(text) {
  if (text === undefined) return new Set();
  return new Set(text.split(/\r?\n/).filter((line) => line !== '' && !line.startsWith('#')));
}

export function apiChanges(files) {
  const changes = [];
  for (const { packageName, before, after } of files) {
    const old = linesOf(before);
    const current = linesOf(after);
    const added = [...current].filter((line) => !old.has(line)).sort(compareCodeUnits);
    const removed = [...old].filter((line) => !current.has(line)).sort(compareCodeUnits);
    if (added.length === 0 && removed.length === 0) continue;
    const exports = new Set(
      [...added, ...removed].map((line) => exportLabel(packageName, exportOfLine(line))),
    );
    changes.push({ packageName, added, removed, exports: [...exports].sort(compareCodeUnits) });
  }
  return changes;
}

export function readChangedFiles({ base, head, git }) {
  const mergeBase = git(['merge-base', base, head]).trim();
  const status = git([
    'diff',
    '--name-status',
    '--no-renames',
    mergeBase,
    head,
    '--',
    'packages/9-public/@prisma/*/api.txt',
  ]);
  const files = [];
  for (const entry of status.split('\n')) {
    const [change, path] = entry.split('\t');
    const packageName = API_FILE.exec(path ?? '')?.[1];
    if (packageName === undefined) continue;
    files.push({
      packageName,
      before: change === 'A' ? undefined : git(['show', `${mergeBase}:${path}`]),
      after: change === 'D' ? undefined : git(['show', `${head}:${path}`]),
    });
  }
  return files.sort((a, b) => compareCodeUnits(a.packageName, b.packageName));
}

function sectionOf(body) {
  const lines = (body ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const start = lines.findIndex((line) => /^##\s+API changes\s*#*\s*$/i.test(line.trim()));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line.trim()));
  return end === -1 ? rest : rest.slice(0, end);
}

function codeSpans(line) {
  return [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
}

function hasReason(line) {
  const words = line.replace(/`[^`]*`/g, ' ').match(/\p{L}{2,}/gu) ?? [];
  return words.length >= 2;
}

export function checkDescription(body, names) {
  const section = sectionOf(body);
  if (section === undefined) return { section: false, missing: [...names], withoutReason: [] };
  const named = new Map();
  for (const line of section) {
    for (const span of codeSpans(line)) {
      named.set(span, (named.get(span) ?? false) || hasReason(line));
    }
  }
  return {
    section: true,
    missing: names.filter((name) => !named.has(name)),
    withoutReason: names.filter((name) => named.get(name) === false),
  };
}

const bulletList = (names) => names.map((name) => `- \`${name}\`:`).join('\n');

export function failureMessage({ section, missing, withoutReason }) {
  const parts = [
    'This pull request changes the public API, and its description does not yet say why for each change.',
  ];
  if (!section) {
    parts.push(
      `Add a section headed "${SECTION}" to the description. Name each export below in backticks, exactly as written here, on a line that also says why it is added, removed or changed. Several names may share one line and one reason.`,
    );
  }
  if (missing.length > 0 && section) {
    parts.push(`The "${SECTION}" section does not name these exports:`);
  }
  if (missing.length > 0) parts.push(bulletList(missing));
  if (withoutReason.length > 0) {
    parts.push(
      `These exports are named on a line that gives no reason; write why on the same line:\n${bulletList(withoutReason)}`,
    );
  }
  parts.push(
    `For example:\n\n${SECTION}\n\n- \`@prisma/orm-postgres/config: defineConfig\`: added so a config file can name the database URL.`,
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
  const packages = changes.length === 1 ? '1 package' : `${changes.length} packages`;
  const names = changes.flatMap(({ exports }) => exports);
  const out = [
    MARKER,
    '## Public API changes',
    '',
    `This pull request changes the \`api.txt\` list of ${packages}. Its description needs a section headed \`${SECTION}\` that names each export below, in backticks, on a line that says why it changes.${template ? ' You can start from this:' : ` The names are in the ${where}.`}`,
    '',
  ];
  if (template) out.push('```markdown', SECTION, '', bulletList(names), '```', '');
  let left = shown;
  let total = 0;
  for (const change of changes) {
    const lines = diffLines(change);
    total += lines.length;
    const visible = lines.slice(0, Math.max(0, left));
    left -= visible.length;
    if (visible.length === 0) continue;
    const fence = fenceFor(visible);
    out.push(`### \`${change.packageName}\``, '', `${fence}diff`, ...visible, fence, '');
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
  if (full.length <= limit) return full;
  const template = render(changes, { shown: 0, template: true, where }).length <= limit;
  let low = 0;
  let high = total;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (render(changes, { shown: middle, template, where }).length <= limit) low = middle;
    else high = middle - 1;
  }
  return render(changes, { shown: low, template, where });
}

async function findComment({ request, repository, prNumber }) {
  for (let page = 1; ; page++) {
    const comments = await request(
      'GET',
      `/repos/${repository}/issues/${prNumber}/comments?per_page=100&page=${page}`,
    );
    const found = comments.find((comment) => comment.body?.startsWith(MARKER));
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
    if (!(error instanceof ApiChangesError) || error.status !== 403) throw error;
    log(`The token may not comment (${error.message}); the list is in the job summary.`);
  }
}

export async function run({ event, repository, readFiles, request, appendSummary, log }) {
  const pullRequest = event.pull_request;
  const changes = apiChanges(readFiles({ base: pullRequest.base.sha, head: pullRequest.head.sha }));
  const isFork = pullRequest.head.repo?.full_name !== repository;

  for (const change of changes) {
    log(`${change.packageName}:\n${diffLines(change).join('\n')}`);
  }
  await publish({
    comment: commentBody(changes, { limit: COMMENT_LIMIT }),
    summary:
      changes.length === 0
        ? undefined
        : commentBody(changes, { limit: SUMMARY_LIMIT, where: 'job log' }),
    createComment: changes.length > 0,
    isFork,
    prNumber: event.number,
    repository,
    request,
    appendSummary,
    log,
  });

  if (changes.length === 0) return { ok: true, message: 'This pull request changes no api.txt.' };
  const result = checkDescription(
    pullRequest.body,
    changes.flatMap(({ exports }) => exports),
  );
  if (result.missing.length === 0 && result.withoutReason.length === 0) {
    return { ok: true, message: 'The description names every changed export with a reason.' };
  }
  const message = failureMessage(result);
  appendSummary(`\n## Description check\n\n${message}\n`);
  return { ok: false, message };
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
    readFiles: ({ base, head }) => readChangedFiles({ base, head, git }),
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
