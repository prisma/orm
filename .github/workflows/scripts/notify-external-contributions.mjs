import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;
const FIRST_RUN_LOOKBACK_MS = 15 * 60 * 1000;
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const INSIDE_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const INSIDE_PERMISSIONS = new Set(['admin', 'maintain', 'write']);
const ASSOCIATION_NOTES = {
  FIRST_TIME_CONTRIBUTOR: 'first contribution to this repository',
  FIRST_TIMER: 'first contribution on GitHub',
};

export function isOutsideAuthor(item, permission) {
  if (item.user.type === 'Bot') return false;
  if (INSIDE_ASSOCIATIONS.has(item.author_association)) return false;
  return !INSIDE_PERMISSIONS.has(permission);
}

export function windowStart(lastSuccessfulRunStart, until) {
  const earliest = new Date(until.getTime() - MAX_LOOKBACK_MS);
  if (!lastSuccessfulRunStart) return new Date(until.getTime() - FIRST_RUN_LOOKBACK_MS);
  return lastSuccessfulRunStart < earliest ? earliest : lastSuccessfulRunStart;
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
  const note = ASSOCIATION_NOTES[item.author_association];
  const author = `<${item.user.html_url}|${item.user.login}>`;
  const link = `<${item.html_url}|#${item.number} ${escapeSlack(item.title)}>`;
  return `New ${kind}${into} from ${author}${note ? ` (${note})` : ''}\n${link}`;
}

function createGitHubClient(token, repository) {
  const request = async (path) => {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'notify-external-contributions',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response;
  };
  const getJson = async (path) => {
    const response = await request(path);
    if (!response.ok) {
      throw new Error(`GitHub ${path} responded ${response.status}: ${await response.text()}`);
    }
    return response.json();
  };

  return {
    async runWindowEnd(runId) {
      const run = await getJson(`/repos/${repository}/actions/runs/${runId}`);
      return { until: new Date(run.created_at), workflowId: run.workflow_id };
    },

    async lastSuccessfulRunStart(workflowId) {
      const { workflow_runs: runs } = await getJson(
        `/repos/${repository}/actions/workflows/${workflowId}/runs?status=success&per_page=1`,
      );
      return runs[0] ? new Date(runs[0].created_at) : undefined;
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
      const response = await request(
        `/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`,
      );
      if (response.status === 404) return 'none';
      if (!response.ok) {
        throw new Error(
          `GitHub permission of ${login} responded ${response.status}: ${await response.text()}`,
        );
      }
      return (await response.json()).permission;
    },

    async baseBranchOf(number) {
      return (await getJson(`/repos/${repository}/pulls/${number}`)).base.ref;
    },
  };
}

async function postToSlack(webhookUrl, text) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, unfurl_links: false }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Slack responded ${response.status}: ${await response.text()}`);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`The ${name} environment variable is not set.`);
  return value;
}

async function resolveWindow(github, options) {
  if (options.since) {
    return { since: new Date(options.since), until: new Date() };
  }
  const { until, workflowId } = await github.runWindowEnd(requireEnv('GITHUB_RUN_ID'));
  const since = windowStart(await github.lastSuccessfulRunStart(workflowId), until);
  return { since, until };
}

async function main() {
  const { values: options } = parseArgs({
    options: { since: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
  });
  const dryRun = options['dry-run'];
  const github = createGitHubClient(requireEnv('GITHUB_TOKEN'), requireEnv('GITHUB_REPOSITORY'));
  const webhookUrl = dryRun ? undefined : requireEnv('SLACK_WEBHOOK_URL');

  const { since, until } = await resolveWindow(github, options);
  console.log(
    `Looking for issues and pull requests created from ${since.toISOString()} to ${until.toISOString()}.`,
  );

  const permissions = new Map();
  for (const item of await github.itemsCreatedBetween(since, until)) {
    const login = item.user.login;
    if (!permissions.has(login)) permissions.set(login, await github.permissionOf(login));
    if (!isOutsideAuthor(item, permissions.get(login))) continue;

    const baseBranch = item.pull_request ? await github.baseBranchOf(item.number) : undefined;
    const message = formatSlackMessage(item, baseBranch);
    if (dryRun) {
      console.log(`${message}\n`);
    } else {
      await postToSlack(webhookUrl, message);
      console.log(`Posted #${item.number} by ${login}.`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
