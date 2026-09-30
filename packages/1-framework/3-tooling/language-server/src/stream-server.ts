import {
  createConnection,
  type DataCallback,
  type Message,
  type MessageReader,
  type MessageWriter,
  ProposedFeatures,
  type WatchDog,
} from 'vscode-languageserver';
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { captureConsole } from './console-capture';
import { createServer } from './server';
import { byteInputStream, type LanguageServerStreams, textOutputStream } from './stdio-transport';

/**
 * How long the conversation may stand completely still before a message the
 * connection took off the reader but never dispatched is written off. It
 * answers a cancellation itself without telling anyone, so the count of
 * messages awaiting dispatch can be left standing; every other route decrements
 * it. Any activity restarts the clock, so this delays the exit rather than
 * cutting a reply short.
 */
const stalledDispatchGraceMs = 50;

/**
 * How long a host abort lets in-flight work drain before the run settles
 * regardless. The host has already decided to stop, so a handler that never
 * settles — or work that never goes idle — must not hold the exit code back
 * forever; it only gets this long to finish cleanly.
 */
const abortDrainDeadlineMs = 2_000;

/**
 * How often the client's process id is polled when the host handed one over.
 * The same cadence `vscode-languageserver/node` uses for its own watch.
 */
const clientProcessPollMs = 3_000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the server over the host's streams and resolves with the exit code the
 * client's departure implies. The host owns the process, so nothing here ends
 * it; every route out settles the promise instead.
 */
export function runServerOverStreams(streams: LanguageServerStreams): Promise<number> {
  const input = byteInputStream(streams.stdin);
  const inputMessages = new StreamMessageReader(input);
  const outputMessages = new StreamMessageWriter(textOutputStream(streams.stdout));
  const releaseConsole = captureConsole(streams.stderr);

  return new Promise<number>((resolve) => {
    let settled = false;
    /**
     * Messages the connection is handling and replies it is writing. A request
     * handler's dispatch covers everything it awaits and the write of its
     * reply, so this stays above zero for as long as the client is owed
     * anything.
     */
    let inFlight = 0;
    /** Messages decoded off the stream that the connection has not started. */
    let awaitingDispatch = 0;
    let lastActivity = Date.now();
    let departure: (() => number) | undefined;
    let idleCheck: NodeJS.Timeout | undefined;
    let abortDeadline: NodeJS.Timeout | undefined;
    let clientWatch: NodeJS.Timeout | undefined;

    function settle(code: number): void {
      if (settled) {
        return;
      }
      settled = true;
      if (idleCheck !== undefined) {
        clearTimeout(idleCheck);
      }
      if (abortDeadline !== undefined) {
        clearTimeout(abortDeadline);
      }
      if (clientWatch !== undefined) {
        clearInterval(clientWatch);
      }
      void server.dispose().finally(() => {
        releaseConsole();
        input.destroy();
        resolve(code);
      });
    }

    function moved(): void {
      lastActivity = Date.now();
      checkIdle();
    }

    /**
     * Settles once nothing is left in flight. The client's departure is not the
     * end of the work: everything already read is queued, and a handler that
     * awaits — resolving a project reads the filesystem — has its reply written
     * turns later.
     */
    function settleOnceIdle(code: () => number): void {
      departure ??= code;
      checkIdle();
    }

    function checkIdle(): void {
      if (settled || departure === undefined || idleCheck !== undefined) {
        return;
      }
      idleCheck = setTimeout(() => {
        idleCheck = undefined;
        if (settled || departure === undefined) {
          return;
        }
        if (inFlight > 0) {
          return;
        }
        if (awaitingDispatch === 0 || Date.now() - lastActivity >= stalledDispatchGraceMs) {
          settle(departure());
          return;
        }
        checkIdle();
      }, 1);
    }

    /** LSP reserves 0 for a client that asked to shut down before leaving. */
    function departureCode(): number {
      return watchDog.shutdownReceived ? 0 : 1;
    }

    const reader: MessageReader = {
      onError: inputMessages.onError,
      onClose: inputMessages.onClose,
      onPartialMessage: inputMessages.onPartialMessage,
      listen: (callback: DataCallback) =>
        inputMessages.listen((message) => {
          awaitingDispatch += 1;
          moved();
          callback(message);
        }),
      dispose: () => inputMessages.dispose(),
    };

    const writer: MessageWriter = {
      onError: outputMessages.onError,
      onClose: outputMessages.onClose,
      write: (message: Message) => {
        inFlight += 1;
        moved();
        return outputMessages.write(message).finally(() => {
          inFlight -= 1;
          moved();
        });
      },
      end: () => outputMessages.end(),
      dispose: () => outputMessages.dispose(),
    };

    const watchDog: WatchDog = {
      shutdownReceived: false,
      // The node transport polls the client's process id here and exits when
      // the editor dies. Over injected stdio that arrives as end of input.
      initialize: () => undefined,
      exit: (code) => settleOnceIdle(() => code),
    };
    const server = createServer(
      createConnection(
        (logger) =>
          createProtocolConnection(reader, writer, logger, {
            messageStrategy: {
              handleMessage: (message, next) => {
                awaitingDispatch -= 1;
                inFlight += 1;
                moved();
                return Promise.resolve(next(message)).finally(() => {
                  inFlight -= 1;
                  moved();
                });
              },
            },
          }),
        watchDog,
        ProposedFeatures.all,
      ),
    );

    inputMessages.onClose(() => settleOnceIdle(departureCode));
    // A frame the reader cannot make sense of leaves it desynchronised for the
    // rest of the stream — nothing further will decode — so the run ends rather
    // than sitting there holding a parser nobody can reach.
    inputMessages.onError((error) => {
      streams.stderr.write(`Language server transport error: ${messageOf(error)}\n`);
      settleOnceIdle(() => 1);
    });

    // A client that dies without closing the conversation left nobody to
    // reply to, so a dead client settles the run directly rather than
    // draining. Unref'd: the watch must never be what keeps the host alive.
    const clientProcessId = streams.clientProcessId;
    if (clientProcessId !== undefined) {
      const settleIfClientGone = (): void => {
        if (!processAlive(clientProcessId)) {
          settle(departureCode());
        }
      };
      clientWatch = setInterval(settleIfClientGone, clientProcessPollMs);
      clientWatch.unref();
      settleIfClientGone();
    }

    // An abort still drains through the idle route when it can, but the host
    // has already decided to stop, so the drain gets a deadline: past it the
    // run settles with whatever is still in flight abandoned.
    function settleOnAbort(): void {
      settleOnceIdle(departureCode);
      abortDeadline ??= setTimeout(() => settle(departureCode()), abortDrainDeadlineMs);
      abortDeadline.unref();
    }

    const hostShutdown = streams.signal;
    if (hostShutdown?.aborted === true) {
      settleOnAbort();
    } else {
      hostShutdown?.addEventListener('abort', settleOnAbort, { once: true });
    }
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
