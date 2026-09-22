import { createTestCli } from '@prisma/cli-engine/testing';
import { describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { ormCommandFamily } from '../../src/orm/family';

function framed(message: unknown): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

interface Frame {
  readonly contentLength: number;
  readonly body: string;
}

function parseFrames(text: string): readonly Frame[] {
  const bytes = Buffer.from(text, 'utf8');
  const frames: Frame[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const headerEnd = bytes.indexOf('\r\n\r\n', offset, 'ascii');
    if (headerEnd === -1) {
      break;
    }
    const declared = /content-length: *(\d+)/i.exec(
      bytes.toString('ascii', offset, headerEnd),
    )?.[1];
    if (declared === undefined) {
      throw new Error(`Frame without a Content-Length header: ${text.slice(offset)}`);
    }
    const contentLength = Number(declared);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (bytes.length < bodyEnd) {
      break;
    }
    frames.push({ contentLength, body: bytes.toString('utf8', bodyStart, bodyEnd) });
    offset = bodyEnd;
  }
  return frames;
}

const initialize = framed({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { processId: null, rootUri: null, capabilities: {}, workspaceFolders: null },
});
const initialized = framed({ jsonrpc: '2.0', method: 'initialized', params: {} });
const shutdown = framed({ jsonrpc: '2.0', id: 2, method: 'shutdown' });
const exit = framed({ jsonrpc: '2.0', method: 'exit' });

function harness(): ReturnType<typeof createTestCli> {
  return createTestCli({
    commandFamilies: [ormCommandFamily],
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
  });
}

describe('lsp', () => {
  it('answers initialize and exits 0 after shutdown', async () => {
    const run = await harness().run(['lsp'], {
      stdin: `${initialize}${initialized}${shutdown}${exit}`,
    });

    // Two frames, not the three a real editor sees: the harness ends stdin
    // with the whole script, so by the time `initialized` is dispatched the
    // connection is closed and the server's "no watched-file registration"
    // warning has nowhere to go. Against a client that stays connected the
    // same exchange also carries that `window/logMessage`.
    const frames = parseFrames(run.stdout);
    expect(frames).toHaveLength(2);
    const parsed: { readonly id: number; readonly result: { readonly capabilities: unknown } } =
      JSON.parse(frames[0]?.body ?? '');
    expect(parsed.id).toBe(1);
    expect(parsed.result.capabilities).toMatchObject({
      documentFormattingProvider: true,
      foldingRangeProvider: true,
      completionProvider: { triggerCharacters: ['.', '@', '[', '(', '{', ':', ','] },
    });
    expect(JSON.parse(frames[1]?.body ?? '')).toEqual({ jsonrpc: '2.0', id: 2, result: null });
    expect(run.exitCode).toBe(0);
  });

  it('exits 1 when the client disconnects without shutting down', async () => {
    const run = await harness().run(['lsp'], { stdin: initialize });

    expect(parseFrames(run.stdout)).toHaveLength(1);
    expect(run.exitCode).toBe(1);
  });

  it('accepts --stdio and speaks the same protocol', async () => {
    const run = await harness().run(['lsp', '--stdio'], {
      stdin: `${initialize}${shutdown}${exit}`,
    });

    expect(parseFrames(run.stdout)).toHaveLength(2);
    expect(run.exitCode).toBe(0);
  });

  // `vscode-languageclient` appends `--clientProcessId=<pid>` to every server
  // its NodeModule form spawns, spelled exactly like this.
  it('accepts the parent process id the standard editor client appends', async () => {
    const run = await harness().run(['lsp', '--stdio', `--clientProcessId=${process.pid}`], {
      stdin: `${initialize}${shutdown}${exit}`,
    });

    expect(parseFrames(run.stdout)).toHaveLength(2);
    expect(run.exitCode).toBe(0);
  });

  it('accepts the kebab-case spelling of the parent process id', async () => {
    const run = await harness().run(['lsp', '--client-process-id', `${process.pid}`], {
      stdin: `${initialize}${shutdown}${exit}`,
    });

    expect(parseFrames(run.stdout)).toHaveLength(2);
    expect(run.exitCode).toBe(0);
  });

  describe('when a signal ends the run', () => {
    it('reports 143 for SIGTERM', async () => {
      const host = new AbortController();
      host.abort('SIGTERM');

      const run = await harness().run(['lsp'], { stdin: initialize, abort: host.signal });

      expect(run.exitCode).toBe(143);
    });

    it('reports 130 for an interrupt', async () => {
      const host = new AbortController();
      host.abort('SIGINT');

      const run = await harness().run(['lsp'], { stdin: initialize, abort: host.signal });

      expect(run.exitCode).toBe(130);
    });
  });

  it('presents nothing of its own on the streams the client owns', async () => {
    const run = await harness().run(['lsp'], { stdin: `${initialize}${shutdown}${exit}` });

    // The frame count above is the harness's; this asserts the stronger thing
    // it can: every byte on stdout belongs to a frame.
    const frames = parseFrames(run.stdout);
    const framedBytes = frames.reduce(
      (total, frame) =>
        total +
        frame.contentLength +
        Buffer.byteLength(`Content-Length: ${frame.contentLength}`) +
        4,
      0,
    );
    expect(Buffer.byteLength(run.stdout, 'utf8')).toBe(framedBytes);
    expect(run.stderr).toBe('');
    expect(run.events).toEqual([]);
    expect(run.presented).toBeUndefined();
  });
});
