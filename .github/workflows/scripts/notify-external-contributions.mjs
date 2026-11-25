import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;
const FIRST_RUN_LOOKBACK_MS = 15 * 60 * 1000;
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SLACK_ATTEMPTS = 3;
const SLACK_SPACING_MS = 1000;

// docs/oss/pr-triage.md#who-counts-as-external: an agent account that belongs to a team member is team.
const TEAM_AGENT_ACCOUNTS = new Map([['StevenMcClankerton', 'SevInf']]);
const TEAM_PERMISSIONS = new Set(['admin', 'write']);

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isTeamAccount(user) {
  return user.type === 'Bot' || TEAM_AGENT_ACCOUNTS.has(user.login);
}

export function lastScheduledRunStart(successfulRuns) {
  const starts = successfulRuns.map((run) => new Date(run.created_at));
  return starts.length ? new Date(Math.max(...starts)) : undefined;
}

export function resolveWindow(lastRunStart, until) {
  const earliest = new Date(until.getTime() - MAX_LOOKBACK_MS);
  if (!lastRunStart) {
    return { since: new Date(until.getTime() - FIRST_RUN_LOOKBACK_MS), until, skipped: undefined };
  }
  if (lastRunStart < earliest) {
    return { since: earliest, until, skipped: { from: lastRunStart, to: earliest } };
  }
  return { since: lastRunStart, until, skipped: undefined };
}

export function itemsCreatedInWindow(newestFirstPage, since, until) {
  const created = (item) => new Date(item.created_at);
  const items = newestFirstPage
    .filter((item) => created(item) >= since && created(item) < until)
    .reverse();
  const reachedStart = newestFirstPage.some((item) => created(item) < since);
  return { items, reachedStart };
}

const escapeSlack = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function formatSlackMessage(item, baseBranch) {
  const kind = item.pull_request ? 'pull request' : 'issue';
  const into = baseBranch ? ` into \`${baseBranch}\`` : '';
  const author = `<${item.user.html_url}|${item.user.login}>`;
  const link = `<${item.html_url}|#${item.number} ${escapeSlack(item.title)}>`;
  return `New ${kind}${into} from ${author}\n${link}`;
}

export function createGitHubClient({ token, repository, fetch = globalThis.fetch }) {
  const request = (path) =>
    fetch(`${GITHUB_API}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'notify-external-contributions',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  const failure = async (path, response) =>
    new Error(`GitHub ${path} responded ${response.status}: ${await response.text()}`);
  const getJson = async (path) => {
    const response = await request(path);
    if (!response.ok) throw await failure(path, response);
    return response.json();
  };

  return {
    async currentRun(runId) {
      const run = await getJson(`/repos/${repository}/actions/runs/${runId}`);
      return { createdAt: new Date(run.created_at), workflowId: run.workflow_id };
    },

    async successfulScheduledRuns(workflowId) {
      const { workflow_runs: runs } = await getJson(
        `/repos/${repository}/actions/workflows/${workflowId}/runs?event=schedule&status=success&per_page=20`,
      );
      return runs;
    },

    async itemsCreatedBetween(since, until) {
      const collected = [];
      for (let page = 1; ; page++) {
        const newestFirst = await getJson(
          `/repos/${repository}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`,
        );
        const { items, reachedStart } = itemsCreatedInWindow(newestFirst, since, until);
        collected.unshift(...items);
        if (reachedStart || newestFirst.length < 100) return collected;
      }
    },

    async permissionOf(login) {
      const path = `/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`;
      const response = await request(path);
      if (response.status === 404) return 'none';
      if (!response.ok) throw await failure(path, response);
      return (await response.json()).permission;
    },

    async baseBranchOf(number) {
      return (await getJson(`/repos/${repository}/pulls/${number}`)).base.ref;
    },
  };
}

export async function collectOutsideContributions(github, since, until) {
  const permissions = new Map();
  const permissionOf = async (login) => {
    if (!permissions.has(login)) permissions.set(login, await github.permissionOf(login));
    return permissions.get(login);
  };

  const messages = [];
  for (const item of await github.itemsCreatedBetween(since, until)) {
    if (isTeamAccount(item.user)) continue;
    if (TEAM_PERMISSIONS.has(await permissionOf(item.user.login))) continue;
    const baseBranch = item.pull_request ? await github.baseBranchOf(item.number) : undefined;
    messages.push({ number: item.number, text: formatSlackMessage(item, baseBranch) });
  }
  return messages;
}

export async function postToSlack(
  webhookUrl,
  text,
  { fetch = globalThis.fetch, sleep = sleepFor } = {},
) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, unfurl_links: false }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return;
    if (response.status !== 429 || attempt === SLACK_ATTEMPTS) {
      throw new Error(`Slack responded ${response.status}: ${await response.text()}`);
    }
    await sleep(Number(response.headers.get('retry-after') ?? 1) * 1000);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`The ${name} environment variable is not set.`);
  return value;
}

function parseOptions() {
  const { values } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false }, hours: { type: 'string' } },
  });
  if (!values['dry-run']) {
    if (values.hours !== undefined) throw new Error('--hours is only for a dry run.');
    return { dryRun: false };
  }
  const hours = Number(values.hours ?? 24);
  if (!(hours > 0)) throw new Error(`--hours must be a positive number, not ${values.hours}.`);
  return { dryRun: true, hours };
}

export async function scheduledWindow(github, runId) {
  const { createdAt, workflowId } = await github.currentRun(runId);
  const runs = await github.successfulScheduledRuns(workflowId);
  return resolveWindow(lastScheduledRunStart(runs), createdAt);
}

async function main() {
  const options = parseOptions();
  const github = createGitHubClient({
    token: requireEnv('GITHUB_TOKEN'),
    repository: requireEnv('GITHUB_REPOSITORY'),
  });
  const webhookUrl = options.dryRun ? undefined : requireEnv('SLACK_WEBHOOK_URL');

  const now = new Date();
  const { since, until, skipped } = options.dryRun
    ? { since: new Date(now.getTime() - options.hours * 3_600_000), until: now, skipped: undefined }
    : await scheduledWindow(github, requireEnv('GITHUB_RUN_ID'));
  if (since >= until) {
    console.log(
      'A later scheduled run has already covered this run’s time, so there is nothing to post.',
    );
    return;
  }
  if (skipped) {
    console.log(
      `::warning::No scheduled run succeeded from ${skipped.from.toISOString()} to ${skipped.to.toISOString()}. Items created then were not posted.`,
    );
  }
  console.log(
    `Looking for issues and pull requests created from ${since.toISOString()} to ${until.toISOString()}.`,
  );

  const messages = await collectOutsideContributions(github, since, until);
  for (const [index, { number, text }] of messages.entries()) {
    if (options.dryRun) {
      console.log(`${text}\n`);
      continue;
    }
    if (index > 0) await sleepFor(SLACK_SPACING_MS);
    await postToSlack(webhookUrl, text);
    console.log(`Posted #${number}.`);
  }
  console.log(`${messages.length} outside contributions ${options.dryRun ? 'found' : 'posted'}.`);
}

const invokedPath = process.argv[1] && realpathSync(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
