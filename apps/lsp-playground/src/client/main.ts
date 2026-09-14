/// <reference types="vite/client" />

import { LogLevel } from '@codingame/monaco-vscode-api';
import {
  type IExtensionManifest,
  registerExtension,
} from '@codingame/monaco-vscode-api/extensions';
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

interface RuntimeConfig {
  readonly wsPath: string;
  readonly documentUri: string;
  readonly rootUri: string;
  readonly schemaPath: string;
  readonly schemaText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRuntimeConfig(value: unknown): value is RuntimeConfig {
  return (
    isRecord(value) &&
    typeof value['wsPath'] === 'string' &&
    typeof value['documentUri'] === 'string' &&
    typeof value['rootUri'] === 'string' &&
    typeof value['schemaPath'] === 'string' &&
    typeof value['schemaText'] === 'string'
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

  const pathEl = document.getElementById('schema-path');
  if (pathEl !== null) {
    pathEl.textContent = runtimeConfig.schemaPath;
  }

  const htmlContainer = document.getElementById('editor');
  if (htmlContainer === null) {
    throw new Error('#editor mount point not found');
  }

  const formatButton = document.getElementById('format-document');
  if (!(formatButton instanceof HTMLButtonElement)) {
    throw new Error('#format-document button not found');
  }

  const fileUri = vscode.Uri.parse(runtimeConfig.documentUri);
  const fileSystemProvider = new RegisteredFileSystemProvider(false);
  fileSystemProvider.registerFile(new RegisteredMemoryFile(fileUri, runtimeConfig.schemaText));
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
      initializationOptions: { completion: { supportsTriggerSuggestCommand: true } },
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
        text: runtimeConfig.schemaText,
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

  const languageClientWrapper = new LanguageClientWrapper(languageClientConfig);
  await languageClientWrapper.start();

  await vscode.workspace.openTextDocument(fileUri);

  formatButton.addEventListener('click', async () => {
    await vscode.commands.executeCommand('editor.action.formatDocument');
  });
}

main().catch(console.error);
