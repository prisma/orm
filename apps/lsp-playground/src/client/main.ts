/// <reference types="vite/client" />

import { LogLevel } from '@codingame/monaco-vscode-api';
import {
  type IExtensionManifest,
  registerExtension,
} from '@codingame/monaco-vscode-api/extensions';
import {
  createModelReference,
  type IReference,
  type ITextFileEditorModel,
} from '@codingame/monaco-vscode-api/monaco';
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

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * One scratch-project member as the client tracks it: its Monaco-facing
 * identity (`uri`/`path`), the text last known for it (the seed text until
 * the tab is opened and edited, then whatever the editor model held when the
 * user last switched away), and whether `didOpen` has been sent for it yet.
 *
 * A tab's document opens — and `didOpen` fires — only the first time it is
 * activated; re-activating an already-opened tab only swaps the visible
 * model, never re-opens it.
 */
interface Tab {
  readonly uri: string;
  readonly path: string;
  readonly button: HTMLButtonElement;
  text: string;
  opened: boolean;
  /**
   * A model reference held for the lifetime of the page once opened, never
   * disposed. `EditorApp.updateCodeResources` disposes its *own* transient
   * reference to whichever model the editor stops showing; without a second,
   * independently-held reference keeping the ref count above zero, the
   * underlying document closes (and its `didOpen` re-fires) every time its
   * tab is switched away from and back to, defeating "switching back only
   * swaps the visible model".
   */
  pin: IReference<ITextFileEditorModel> | undefined;
}

async function main(): Promise<void> {
  const runtimeConfig = await loadRuntimeConfig();
  if (runtimeConfig.members.length === 0) {
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

  const tabStrip = document.getElementById('tab-strip');
  if (tabStrip === null) {
    throw new Error('#tab-strip mount point not found');
  }

  const fileSystemProvider = new RegisteredFileSystemProvider(false);
  const tabs: Tab[] = runtimeConfig.members.map((member) => {
    const uri = vscode.Uri.parse(member.uri);
    fileSystemProvider.registerFile(new RegisteredMemoryFile(uri, member.text));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.textContent = basename(uri.path);
    tabStrip.appendChild(button);
    return {
      uri: member.uri,
      path: uri.path,
      button,
      text: member.text,
      opened: false,
      pin: undefined,
    };
  });
  registerFileSystemOverlay(1, fileSystemProvider);

  const firstTab = tabs[0];
  if (firstTab === undefined) {
    throw new Error('Playground runtime config carries no scratch-project members');
  }

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
        text: firstTab.text,
        uri: firstTab.path,
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

  let activeTab = firstTab;
  const setActiveStyling = (): void => {
    for (const tab of tabs) {
      tab.button.classList.toggle('active', tab === activeTab);
    }
  };

  async function openTab(tab: Tab): Promise<void> {
    // First activation only: this is the one `didOpen` a never-clicked tab
    // never sends. `openTextDocument` — via vscode-languageclient's
    // document-sync feature — is what notifies the language server.
    await vscode.workspace.openTextDocument(vscode.Uri.parse(tab.uri));
    // Pin a second, independently-held model reference so the document stays
    // open server-side even after `updateCodeResources` later disposes its
    // own reference while switching to a different tab (see the `pin` field
    // doc on `Tab`).
    tab.pin = await createModelReference(vscode.Uri.parse(tab.uri));
    tab.opened = true;
  }

  async function activateTab(tab: Tab): Promise<void> {
    if (tab === activeTab) {
      return;
    }
    // Capture the outgoing tab's live edits so switching back later restores
    // them instead of the stale seed text (updateCodeResources below writes
    // whatever text it is given back into the file-system overlay).
    const outgoingModel = editorApp.getEditor()?.getModel();
    if (outgoingModel !== null && outgoingModel !== undefined) {
      activeTab.text = outgoingModel.getValue();
    }
    if (!tab.opened) {
      await openTab(tab);
    }
    await editorApp.updateCodeResources({ modified: { text: tab.text, uri: tab.path } });
    activeTab = tab;
    setActiveStyling();
  }

  for (const tab of tabs) {
    tab.button.addEventListener('click', () => void activateTab(tab));
  }

  // The first tab opens on startup exactly as the single-schema playground
  // always has; every other tab stays unmanaged until its own first click.
  await openTab(firstTab);
  setActiveStyling();

  formatButton.addEventListener('click', async () => {
    await vscode.commands.executeCommand('editor.action.formatDocument');
  });
}

main().catch(console.error);
