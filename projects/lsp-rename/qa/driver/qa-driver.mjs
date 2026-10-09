import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  return new Promise((resolveRequest) => {
    pending.set(id, resolveRequest);
  });
}

function fail(message) {
  console.error(`driver error: ${message}`);
  process.exit(1);
}

async function result(method, params) {
  const response = await request(method, params);
  if (response.error) fail(`${method}: ${JSON.stringify(response.error)}`);
  return response.result;
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
      const resolveRequest = pending.get(message.id);
      pending.delete(message.id);
      resolveRequest(message);
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
const fileOf = (uri) => steps.files.find((name) => uriOf(name) === uri);
const shorten = (value) =>
  JSON.stringify(value).replaceAll(`${pathToFileURL(project).toString()}/`, '<project>/');

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

function offsetAt(text, position) {
  const lines = text.split('\n');
  let offset = 0;
  for (let line = 0; line < position.line; line++) offset += lines[line].length + 1;
  return offset + position.character;
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

function render(uri, range, replacement) {
  const file = fileOf(uri);
  if (file === undefined) return `${uri} ${JSON.stringify(range)}`;
  const lines = textOf(file).split('\n');
  const where = `${basename(file)}:${range.start.line + 1}:${range.start.character + 1}`;
  if (range.start.line !== range.end.line) {
    return `${where} (to line ${range.end.line + 1}) ${lines[range.start.line].trim()} ...`;
  }
  const line = lines[range.start.line];
  if (replacement?.includes('\n')) {
    return `${where}  insert ${JSON.stringify(replacement)} before ${JSON.stringify(line.slice(range.end.character).trim())}`;
  }
  const inside = line.slice(range.start.character, range.end.character);
  const arrow = replacement === undefined ? '' : ` -> ${replacement}`;
  const marked = `${line.slice(0, range.start.character)}<<${inside}${arrow}>>${line.slice(range.end.character)}`;
  return `${where}  ${marked.trim()}`;
}

const key = (uri, range) =>
  `${uri}#${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;

function editEntries(edit) {
  return Object.entries(edit?.changes ?? {}).flatMap(([uri, edits]) =>
    edits.map((textEdit) => ({ uri, ...textEdit })),
  );
}

function printEdit(edit) {
  if (edit === null) {
    console.log('  (null)');
    return;
  }
  if (edit.documentChanges !== undefined) console.log('  response uses documentChanges');
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const file = fileOf(uri);
    const state = file !== undefined && versions.has(file) ? 'open' : 'not open';
    console.log(`  ${file ?? uri} (${state} in the client): ${edits.length} edit(s)`);
    for (const { range, newText } of edits) console.log(`    ${render(uri, range, newText)}`);
  }
}

let applied = [];

function applyEdit(edit, newName) {
  applied = [];
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const file = fileOf(uri);
    if (file === undefined) fail(`edit for a file outside the project: ${uri}`);
    const wasOpen = versions.has(file);
    let text = textOf(file);
    const ordered = [...edits].sort(
      (a, b) => offsetAt(text, b.range.start) - offsetAt(text, a.range.start),
    );
    const starts = [];
    for (const { range, newText } of ordered) {
      const start = offsetAt(text, range.start);
      const end = offsetAt(text, range.end);
      text = `${text.slice(0, start)}${newText}${text.slice(end)}`;
      for (const earlier of starts) earlier.offset += newText.length - (end - start);
      if (newText === newName) starts.push({ offset: start, length: newText.length });
    }
    for (const { offset, length } of starts) {
      applied.push(
        key(uri, { start: positionAt(text, offset), end: positionAt(text, offset + length) }),
      );
    }
    change(file, text);
    console.log(
      `  applied to ${file}: ${wasOpen ? 'didChange' : 'didOpen with the text on disk, then didChange'}`,
    );
  }
}

async function sweep(step) {
  const violations = [];
  let cursors = 0;
  let renameable = 0;
  const lists = new Set();
  const withInsertion = new Set();
  for (const file of step.files) textOf(file);
  for (const file of step.files) {
    open(file);
    const text = textOf(file);
    for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/g)) {
      cursors++;
      const start = positionAt(text, match.index);
      const end = positionAt(text, match.index + match[0].length);
      const position = positionAt(text, match.index + Math.floor(match[0].length / 2));
      const params = { textDocument: { uri: uriOf(file) }, position };
      const here = `${file}:${start.line + 1}:${start.character + 1} ${match[0]}`;
      const references = await result('textDocument/references', {
        ...params,
        context: { includeDeclaration: true },
      });
      const prepared = await result('textDocument/prepareRename', params);
      const edit = await result('textDocument/rename', { ...params, newName: step.newName });
      const referenceKeys = references.map((location) => key(location.uri, location.range));
      const nameEdits = editEntries(edit).filter((entry) => entry.newText === step.newName);
      const insertions = editEntries(edit).filter((entry) => entry.newText !== step.newName);
      const editKeys = nameEdits.map((entry) => key(entry.uri, entry.range));
      if ((prepared !== null) !== (edit !== null)) {
        violations.push(
          `${here}: prepareRename=${JSON.stringify(prepared)} but rename=${JSON.stringify(edit)}`,
        );
      }
      if ((edit !== null) !== references.length > 0) {
        violations.push(
          `${here}: rename ${edit === null ? 'null' : 'non-null'} but references=${references.length}`,
        );
      }
      if (edit === null) continue;
      renameable++;
      lists.add(editKeys.join('|'));
      if (editKeys.join('|') !== referenceKeys.join('|')) {
        violations.push(`${here}: edit ranges differ from the references locations`);
      }
      if (insertions.length > 1) {
        violations.push(`${here}: more than one edit that is not a name edit`);
      }
      for (const insertion of insertions) {
        withInsertion.add(editKeys.join('|'));
        if (!insertion.newText.includes(`map("${match[0]}")`)) {
          violations.push(`${here}: insertion ${JSON.stringify(insertion.newText)}`);
        }
        const declared = references.some((location) => location.uri === insertion.uri);
        if (!declared) violations.push(`${here}: insertion in a file with no name edit`);
      }
      const own = key(uriOf(file), { start, end });
      if (prepared !== null && key(uriOf(file), prepared.range) !== own) {
        violations.push(`${here}: prepareRename range ${JSON.stringify(prepared.range)}`);
      }
      if (prepared !== null && prepared.placeholder !== match[0]) {
        violations.push(`${here}: placeholder ${JSON.stringify(prepared.placeholder)}`);
      }
      if (!editKeys.includes(own)) {
        violations.push(`${here}: the edit does not contain the cursor's own token`);
      }
      for (const entry of nameEdits) {
        const target = fileOf(entry.uri);
        const line =
          target === undefined ? undefined : textOf(target).split('\n')[entry.range.start.line];
        const covered = line?.slice(entry.range.start.character, entry.range.end.character);
        if (covered !== match[0]) {
          violations.push(
            `${here}: edit ${render(entry.uri, entry.range)} covers ${JSON.stringify(covered)}`,
          );
        }
      }
    }
  }
  console.log(`\n[${step.id}] sweep of ${step.files.join(', ')} with newName=${step.newName}`);
  console.log(`  identifier positions requested: ${cursors}`);
  console.log(`  positions with a non-null rename result: ${renameable}`);
  console.log(`  distinct symbols (distinct edit lists): ${lists.size}`);
  console.log(`  symbols whose edit carries a map attribute: ${withInsertion.size}`);
  console.log(`  violations: ${violations.length}`);
  for (const violation of violations) console.log(`    ${violation}`);
}

async function run() {
  const init = await result('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(project).toString(),
    workspaceFolders: [{ uri: pathToFileURL(project).toString(), name: 'qa' }],
    capabilities: {
      textDocument: { rename: { prepareSupport: steps.prepareSupport !== false } },
    },
  });
  send({ method: 'initialized', params: {} });
  console.log(
    `capabilities: renameProvider=${JSON.stringify(init.capabilities.renameProvider)} referencesProvider=${JSON.stringify(init.capabilities.referencesProvider)}`,
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
    if (step.kind === 'save') {
      const target = resolve(step.to);
      mkdirSync(target, { recursive: true });
      for (const file of steps.files) writeFileSync(resolve(target, file), textOf(file));
      console.log(
        `\n[${step.id}] wrote the client's text of ${steps.files.join(', ')} to ${step.to}`,
      );
      continue;
    }
    if (step.kind === 'format') {
      open(step.file);
      const edits = await result('textDocument/formatting', {
        textDocument: { uri: uriOf(step.file) },
        options: { tabSize: 2, insertSpaces: true },
      });
      console.log(`\n[${step.id}] formatting ${step.file}: ${(edits ?? []).length} edit(s)`);
      for (const { newText } of edits ?? []) change(step.file, newText);
      console.log(textOf(step.file).trimEnd().replaceAll(/^/gm, '  | '));
      continue;
    }
    open(step.file);
    const position = cursor(step.file, step.at);
    const params = { textDocument: { uri: uriOf(step.file) }, position };
    const where = `${step.file} at "${step.at}" ${JSON.stringify(position)}`;
    if (step.kind === 'references') {
      const includeDeclaration = step.includeDeclaration === true;
      const locations = await result('textDocument/references', {
        ...params,
        context: { includeDeclaration },
      });
      console.log(`\n[${step.id}] references ${where} includeDeclaration=${includeDeclaration}`);
      console.log(`  raw: ${shorten(locations)}`);
      for (const location of locations) console.log(`  ${render(location.uri, location.range)}`);
      if (locations.length === 0) console.log('  (empty)');
      if (step.compareWithApplied === true) {
        const keys = locations.map((location) => key(location.uri, location.range));
        const same = [...keys].sort().join('|') === [...applied].sort().join('|');
        console.log(`  same positions as the applied edit: ${same ? 'yes' : 'NO'}`);
      }
    } else if (step.kind === 'definition') {
      const targets = (await result('textDocument/definition', params)) ?? [];
      console.log(`\n[${step.id}] definition ${where}`);
      console.log(`  raw: ${shorten(targets)}`);
      for (const target of targets) {
        console.log(
          `  ${render(target.targetUri ?? target.uri, target.targetSelectionRange ?? target.range)}`,
        );
      }
      if (targets.length === 0) console.log('  (none)');
    } else if (step.kind === 'prepareRename') {
      const response = await request('textDocument/prepareRename', params);
      console.log(`\n[${step.id}] prepareRename ${where}`);
      console.log(`  raw: ${shorten(response.error ?? response.result)}`);
      if (response.error) console.log('  (error response)');
      else if (response.result === null) console.log('  (null)');
      else console.log(`  ${render(params.textDocument.uri, response.result.range)}`);
    } else if (step.kind === 'rename') {
      const response = await request('textDocument/rename', { ...params, newName: step.newName });
      console.log(`\n[${step.id}] rename ${where} newName=${JSON.stringify(step.newName)}`);
      if (response.error) {
        console.log(`  error response: ${shorten(response.error)}`);
        continue;
      }
      console.log(`  raw: ${shorten(response.result)}`);
      printEdit(response.result);
      if (step.apply === true && response.result !== null) {
        applyEdit(response.result, step.newName);
      }
    } else {
      fail(`unknown step kind ${step.kind}`);
    }
  }
  await result('shutdown', null);
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
