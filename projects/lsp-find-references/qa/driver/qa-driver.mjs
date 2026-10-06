import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , cliEntry, projectDir, stepsPath] = process.argv;
const project = resolve(projectDir);
const steps = JSON.parse(readFileSync(resolve(stepsPath), 'utf8'));

const server = spawn('node', [resolve(cliEntry), 'lsp', '--stdio'], {
  cwd: project,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
server.stderr.on('data', (chunk) => {
  stderr += chunk;
});

let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
const diagnostics = new Map();

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  server.stdin.write(body);
}

function request(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((resolveRequest, reject) => {
    pending.set(id, { resolveRequest, reject });
  });
}

server.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = Number(
      /Content-Length: (\d+)/.exec(buffer.subarray(0, headerEnd).toString())[1],
    );
    if (buffer.length < headerEnd + 4 + length) return;
    const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.subarray(headerEnd + 4 + length);
    if (message.id !== undefined && message.method === undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolveRequest(message.result);
    } else if (message.id !== undefined) {
      send({ id: message.id, result: null });
    } else if (message.method === 'textDocument/publishDiagnostics') {
      diagnostics.set(message.params.uri, message.params.diagnostics);
    }
  }
});

const texts = new Map();
const versions = new Map();
const uriOf = (file) => pathToFileURL(resolve(project, file)).toString();

function textOf(file) {
  if (!texts.has(file)) texts.set(file, readFileSync(resolve(project, file), 'utf8'));
  return texts.get(file);
}

function open(file) {
  if (versions.has(file)) return;
  versions.set(file, 1);
  send({
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri: uriOf(file), languageId: 'prisma', version: 1, text: textOf(file) },
    },
  });
}

function change(file, text) {
  open(file);
  texts.set(file, text);
  versions.set(file, versions.get(file) + 1);
  send({
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri: uriOf(file), version: versions.get(file) },
      contentChanges: [{ text }],
    },
  });
}

function positionAt(text, offset) {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before[before.length - 1].length };
}

function cursor(file, marked) {
  const text = textOf(file);
  const needle = marked.replace('|', '');
  const start = text.indexOf(needle);
  if (start < 0 || text.indexOf(needle, start + 1) >= 0) {
    console.error(`"${needle}" does not occur exactly once in ${file}`);
    process.exit(1);
  }
  return positionAt(text, start + marked.indexOf('|'));
}

function render(uri, range) {
  const file = [...new Set([...texts.keys(), ...steps.files])].find((name) => uriOf(name) === uri);
  if (file === undefined) return `${uri} ${JSON.stringify(range)}`;
  const lines = textOf(file).split('\n');
  const where = `${basename(file)}:${range.start.line + 1}:${range.start.character + 1}`;
  if (range.start.line !== range.end.line) {
    return `${where} (to line ${range.end.line + 1}) ${lines[range.start.line].trim()} ...`;
  }
  const line = lines[range.start.line];
  const marked = `${line.slice(0, range.start.character)}<<${line.slice(range.start.character, range.end.character)}>>${line.slice(range.end.character)}`;
  return `${where}  ${marked.trim()}`;
}

async function sweep(step) {
  const key = (uri, range) =>
    `${uri}#${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
  const answers = new Map();
  const violations = [];
  let cursors = 0;
  let nonEmpty = 0;
  for (const file of step.files) textOf(file);
  for (const file of step.files) {
    open(file);
    const text = textOf(file);
    for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      cursors++;
      const start = positionAt(text, match.index);
      const end = positionAt(text, match.index + match[0].length);
      const position = positionAt(text, match.index + Math.floor(match[0].length / 2));
      const params = { textDocument: { uri: uriOf(file) }, position };
      const references = await request('textDocument/references', {
        ...params,
        context: { includeDeclaration: true },
      });
      const definition = await request('textDocument/definition', params);
      const here = `${file}:${start.line + 1}:${start.character + 1} ${match[0]}`;
      if (references.length > 0 !== (definition !== null)) {
        violations.push(
          `${here}: references=${references.length} but definition=${JSON.stringify(definition)}`,
        );
      }
      if (references.length === 0) continue;
      nonEmpty++;
      const own = key(uriOf(file), { start, end });
      const keys = references.map((location) => key(location.uri, location.range));
      if (!keys.includes(own))
        violations.push(`${here}: result does not contain the cursor's own token`);
      for (const location of references) {
        const target = [...texts.keys()].find((name) => uriOf(name) === location.uri);
        const line =
          target === undefined ? undefined : textOf(target).split('\n')[location.range.start.line];
        const covered = line?.slice(location.range.start.character, location.range.end.character);
        if (covered !== match[0])
          violations.push(
            `${here}: location ${render(location.uri, location.range)} covers ${JSON.stringify(covered)}`,
          );
      }
      answers.set(own, { here, list: keys.join('|') });
    }
  }
  for (const { here, list } of answers.values()) {
    for (const member of list.split('|')) {
      const other = answers.get(member);
      if (other === undefined)
        violations.push(`${here}: listed location ${member} was never a cursor`);
      else if (other.list !== list)
        violations.push(`${here}: list differs from the list at ${other.here}`);
    }
  }
  console.log(`\n[${step.id}] sweep of ${step.files.join(', ')}`);
  console.log(`  identifier positions requested: ${cursors}`);
  console.log(`  positions with a non-empty references result: ${nonEmpty}`);
  console.log(
    `  distinct symbols (distinct result lists): ${new Set([...answers.values()].map((entry) => entry.list)).size}`,
  );
  console.log(`  violations: ${violations.length}`);
  for (const violation of violations) console.log(`    ${violation}`);
}

async function run() {
  const init = await request('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(project).toString(),
    workspaceFolders: [{ uri: pathToFileURL(project).toString(), name: 'qa' }],
    capabilities: { textDocument: { definition: { linkSupport: steps.linkSupport !== false } } },
  });
  send({ method: 'initialized', params: {} });
  console.log(
    `capabilities: referencesProvider=${JSON.stringify(init.capabilities.referencesProvider)} definitionProvider=${JSON.stringify(init.capabilities.definitionProvider)}`,
  );
  for (const step of steps.steps) {
    if (step.kind === 'open') {
      open(step.file);
      console.log(`\n[${step.id}] didOpen ${step.file}`);
      continue;
    }
    if (step.kind === 'change') {
      change(step.file, textOf(step.file).replace(step.replace, step.with));
      console.log(
        `\n[${step.id}] didChange ${step.file}: ${JSON.stringify(step.replace)} -> ${JSON.stringify(step.with)}`,
      );
      continue;
    }
    if (step.kind === 'diagnostics') {
      await new Promise((done) => setTimeout(done, 1500));
      console.log(`\n[${step.id}] published diagnostics`);
      for (const [uri, items] of diagnostics) {
        console.log(`  ${basename(uri)}: ${items.length === 0 ? '(none)' : ''}`);
        for (const item of items) {
          console.log(
            `    ${item.range.start.line + 1}:${item.range.start.character + 1} ${item.code} ${item.message}`,
          );
        }
      }
      continue;
    }
    if (step.kind === 'sweep') {
      await sweep(step);
      continue;
    }
    if (step.open !== false) open(step.file);
    const position = cursor(step.file, step.at);
    const params = { textDocument: { uri: uriOf(step.file) }, position };
    if (step.kind === 'references') {
      const includeDeclaration = step.includeDeclaration === true;
      const result = await request('textDocument/references', {
        ...params,
        context: { includeDeclaration },
      });
      console.log(
        `\n[${step.id}] references ${step.file} at "${step.at}" ${JSON.stringify(position)} includeDeclaration=${includeDeclaration}`,
      );
      console.log(`  raw: ${JSON.stringify(result)}`);
      for (const location of result ?? []) console.log(`  ${render(location.uri, location.range)}`);
      if ((result ?? []).length === 0) console.log('  (empty)');
    } else {
      const result = await request('textDocument/definition', params);
      console.log(
        `\n[${step.id}] definition ${step.file} at "${step.at}" ${JSON.stringify(position)}`,
      );
      console.log(`  raw: ${JSON.stringify(result)}`);
      for (const entry of result ?? []) {
        if (entry.targetUri !== undefined) {
          console.log(`  name:   ${render(entry.targetUri, entry.targetSelectionRange)}`);
          console.log(`  target: ${render(entry.targetUri, entry.targetRange)}`);
        } else {
          console.log(`  ${render(entry.uri, entry.range)}`);
        }
      }
      if (result === null) console.log('  (null)');
    }
  }
  await request('shutdown', null);
  send({ method: 'exit' });
}

run()
  .catch((error) => {
    console.error(`driver error: ${error.stack ?? error}`);
    process.exitCode = 1;
    server.kill();
  })
  .finally(() => {
    if (stderr.trim() !== '') console.log(`\nserver stderr:\n${stderr}`);
  });
