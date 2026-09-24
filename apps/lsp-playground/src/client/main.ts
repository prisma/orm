/// <reference types="vite/client" />

import { LogLevel } from '@codingame/monaco-vscode-api';
import {
  type IExtensionManifest,
  registerExtension,
} from '@codingame/monaco-vscode-api/extensions';
import { SnippetController2 } from '@codingame/monaco-vscode-api/vscode/vs/editor/contrib/snippet/browser/snippetController2';
import { KeyCode } from '@codingame/monaco-vscode-editor-api';
import editorWorkerUrl from '@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker?worker&url';
import getFilesServiceOverride, {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import type { ILogger } from '@codingame/monaco-vscode-log-service-override';
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { type LanguageClientConfig, LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';
import {
  type MonacoVscodeApiConfig,
  MonacoVscodeApiWrapper,
} from 'monaco-languageclient/vscodeApiWrapper';
import { useWorkerFactory, Worker } from 'monaco-languageclient/workerFactory';
import * as vscode from 'vscode';

const LANGUAGE_ID = 'prisma';
const RUNTIME_CONFIG_PATH = '/__psl_playground_runtime.json';

const pslSemanticThemeExtension = {
  name: 'prisma-psl-semantic-theme-bridge',
  publisher: 'prisma',
  version: '0.0.0',
  engines: { vscode: '*' },
  contributes: {
    semanticTokenScopes: [
      {
        language: LANGUAGE_ID,
        scopes: {
          keyword: ['keyword.control'],
          namespace: ['entity.name.namespace'],
          class: ['entity.name.type.class', 'support.class'],
          struct: ['entity.name.type.struct', 'entity.name.type'],
          type: ['entity.name.type', 'support.type'],
          property: ['variable.other.property'],
          decorator: ['entity.name.function', 'support.function'],
          string: ['string.quoted'],
          number: ['constant.numeric'],
          comment: ['comment.line'],
        },
      },
    ],
  },
} satisfies IExtensionManifest;

registerExtension(pslSemanticThemeExtension, undefined, { system: true });

interface RuntimeMember {
  readonly uri: string;
  readonly text: string;
}

interface RuntimeConfig {
  readonly wsPath: string;
  readonly rootUri: string;
  readonly scratchRootUri: string;
  readonly members: readonly RuntimeMember[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRuntimeMember(value: unknown): value is RuntimeMember {
  return isRecord(value) && typeof value['uri'] === 'string' && typeof value['text'] === 'string';
}

function isRuntimeConfig(value: unknown): value is RuntimeConfig {
  return (
    isRecord(value) &&
    typeof value['wsPath'] === 'string' &&
    typeof value['rootUri'] === 'string' &&
    typeof value['scratchRootUri'] === 'string' &&
    Array.isArray(value['members']) &&
    value['members'].every(isRuntimeMember)
  );
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(RUNTIME_CONFIG_PATH, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      `Failed to load playground runtime config: ${response.status} ${response.statusText}`,
    );
  }
  const value: unknown = await response.json();
  if (!isRuntimeConfig(value)) {
    throw new Error('Invalid playground runtime config');
  }
  return value;
}

function configureWorkerFactory(logger?: ILogger): void {
  const workerLoaders = {
    editorWorkerService: () => new Worker(editorWorkerUrl, { type: 'module' }),
  };
  const config = logger !== undefined ? { workerLoaders, logger } : { workerLoaders };
  useWorkerFactory(config);
}

function buildWebSocketUrl(wsPath: string): string {
  const host = `${window.location.host}${wsPath}`;
  // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
  return window.location.protocol === 'https:' ? `wss://${host}` : `ws://${host}`;
}

async function main(): Promise<void> {
  const runtimeConfig = await loadRuntimeConfig();

  // Temporary shim (multifile-psl-playground S2-D1): render only the first
  // scratch-project member. The tab strip that opens every member — the
  // first eagerly, the rest lazily on first click — lands in dispatch 2.
  const firstMember = runtimeConfig.members[0];
  if (firstMember === undefined) {
    throw new Error('Playground runtime config carries no scratch-project members');
  }

  const htmlContainer = document.getElementById('editor');
  if (htmlContainer === null) {
    throw new Error('#editor mount point not found');
  }

  const formatButton = document.getElementById('format-document');
  if (!(formatButton instanceof HTMLButtonElement)) {
    throw new Error('#format-document button not found');
  }

  const fileUri = vscode.Uri.parse(firstMember.uri);
  const schemaText = firstMember.text;

  const pathEl = document.getElementById('schema-path');
  if (pathEl !== null) {
    pathEl.textContent = fileUri.fsPath;
  }

  const fileSystemProvider = new RegisteredFileSystemProvider(false);
  fileSystemProvider.registerFile(new RegisteredMemoryFile(fileUri, schemaText));
  registerFileSystemOverlay(1, fileSystemProvider);

  const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: 'extended',
    viewsConfig: {
      $type: 'EditorService',
      htmlContainer,
    },
    logLevel: LogLevel.Warning,
    serviceOverrides: {
      ...getFilesServiceOverride(),
      ...getKeybindingsServiceOverride(),
      ...getThemeServiceOverride(),
    },
    userConfiguration: {
      json: JSON.stringify({
        'workbench.colorTheme': 'Default Dark+',
        'editor.wordBasedSuggestions': 'off',
        'editor.semanticHighlighting.enabled': true,
      }),
    },
    monacoWorkerFactory: configureWorkerFactory,
    advanced: {
      enforceSemanticHighlighting: true,
    },
  };

  const wsUrl = buildWebSocketUrl(runtimeConfig.wsPath);
  const languageClientConfig: LanguageClientConfig = {
    languageId: LANGUAGE_ID,
    connection: {
      options: {
        $type: 'WebSocketUrl',
        url: wsUrl,
        startOptions: {
          onCall: () => console.log('Connected to language server'),
          reportStatus: true,
        },
        stopOptions: {
          onCall: () => console.log('Disconnected from language server'),
          reportStatus: true,
        },
      },
    },
    clientOptions: {
      documentSelector: [LANGUAGE_ID],
      initializationOptions: {
        completion: {
          supportsTriggerSuggestCommand: true,
          supportsTriggerParameterHintsCommand: true,
        },
      },
      workspaceFolder: {
        index: 0,
        name: 'workspace',
        uri: vscode.Uri.parse(runtimeConfig.rootUri),
      },
    },
  };

  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        text: schemaText,
        uri: fileUri.path,
      },
    },
    editorOptions: {
      fontSize: 16,
      lineHeight: 24,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, monospace',
      minimap: { enabled: false },
      folding: true,
      foldingStrategy: 'auto',
      showFoldingControls: 'always',
    },
    languageDef: {
      languageExtensionConfig: {
        id: LANGUAGE_ID,
        extensions: ['.psl', '.prisma'],
        aliases: ['Prisma Schema Language', 'PSL'],
      },
    },
  };

  const apiWrapper = new MonacoVscodeApiWrapper(vscodeApiConfig);
  await apiWrapper.start();

  const editorApp = new EditorApp(editorAppConfig);
  await editorApp.start(htmlContainer);

  const editor = editorApp.getEditor();
  const snippetHints = editor?.onKeyUp((event) => {
    if (
      event.keyCode === KeyCode.Tab &&
      editor.getModel()?.getLanguageId() === LANGUAGE_ID &&
      editor.getContribution<SnippetController2>(SnippetController2.ID)?.isInSnippet()
    ) {
      void vscode.commands.executeCommand('editor.action.triggerParameterHints');
    }
  });
  editor?.onDidDispose(() => snippetHints?.dispose());

  const languageClientWrapper = new LanguageClientWrapper(languageClientConfig);
  await languageClientWrapper.start();

  await vscode.workspace.openTextDocument(fileUri);

  formatButton.addEventListener('click', async () => {
    await vscode.commands.executeCommand('editor.action.formatDocument');
  });
}

main().catch(console.error);
