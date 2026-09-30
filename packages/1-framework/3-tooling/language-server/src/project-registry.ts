import { fileURLToPath } from 'node:url';
import { findNearestConfigPathForFile } from '@internal/config-loader';
import { join } from 'pathe';
import {
  type Connection,
  DidChangeWatchedFilesNotification,
  type FileEvent,
  RegistrationRequest,
} from 'vscode-languageserver';
import { CONFIG_FILENAME } from './config-resolution';
import type { DocumentStore } from './document-store';
import { Project } from './project';
import { canonicalFileIdentity, normalizeFileUri } from './schema-inputs';

interface RegistryCapabilities {
  readonly pullDiagnostics: boolean;
  readonly watchedFilesRegistration: boolean;
  readonly diagnosticsRefresh: boolean;
}

export class ProjectRegistry {
  readonly #documents: DocumentStore;
  readonly #connection: Connection;
  readonly #projectsByConfig = new Map<string, Project>();
  readonly #projectsByDocument = new Map<string, Project>();
  #eventSequence = 0;
  #capabilities: RegistryCapabilities = {
    pullDiagnostics: false,
    watchedFilesRegistration: false,
    diagnosticsRefresh: false,
  };

  constructor(documents: DocumentStore, connection: Connection) {
    this.#documents = documents;
    this.#connection = connection;
  }

  setClientCapabilities(capabilities: RegistryCapabilities): void {
    this.#capabilities = capabilities;
  }

  async nearestProject(uri: string): Promise<Project | undefined> {
    const knownProject = this.associatedProject(uri);
    if (knownProject !== undefined) return knownProject;
    const filePath = filePathFromUri(uri);
    if (filePath === undefined) return undefined;
    let configPath: string | undefined;
    try {
      configPath = await findNearestConfigPathForFile(filePath);
    } catch {
      return undefined;
    }
    if (configPath === undefined) return undefined;
    const project = this.#projectForConfig(configPath);
    this.#projectsByDocument.set(canonicalFileIdentity(uri), project);
    return project;
  }

  associatedProject(uri: string): Project | undefined {
    return this.#projectsByDocument.get(canonicalFileIdentity(uri));
  }

  documentChanged(uri: string): void {
    this.associatedProject(uri)?.documentChanged(uri);
    void this.#publishForDocument(uri).catch((error: unknown) => {
      this.#connection.console.error(error instanceof Error ? error.message : String(error));
    });
  }

  documentClosed(uri: string): void {
    const project = this.associatedProject(uri);
    project?.documentClosed(uri);
    this.#projectsByDocument.delete(canonicalFileIdentity(uri));
    if (project?.artifacts === undefined) {
      if (!this.#capabilities.pullDiagnostics) {
        void this.#connection.sendDiagnostics({ uri: normalizeFileUri(uri), diagnostics: [] });
      }
      return;
    }
    project.publishMembers();
  }

  watchConfigFiles(rootPath: string): void {
    if (this.#capabilities.watchedFilesRegistration) {
      void this.#connection.sendRequest(RegistrationRequest.type, {
        registrations: [
          {
            id: 'prisma-8-config-watcher',
            method: DidChangeWatchedFilesNotification.type.method,
            registerOptions: { watchers: [{ globPattern: join(rootPath, '**', CONFIG_FILENAME) }] },
          },
        ],
      });
    } else {
      this.#connection.console.warn(
        'Client does not support dynamic file-watcher registration; Prisma 8 config changes will not be picked up without a restart.',
      );
    }
  }

  async watchedFilesChanged(changes: readonly FileEvent[]): Promise<void> {
    const changedConfigPaths = new Set<string>();
    const memberChanges: string[] = [];
    for (const change of changes) {
      const filePath = filePathFromUri(change.uri);
      if (filePath?.endsWith(CONFIG_FILENAME)) changedConfigPaths.add(filePath);
      else memberChanges.push(change.uri);
    }
    const configRefreshes = Array.from(changedConfigPaths, async (configPath) => {
      return this.#projectsByConfig
        .get(configPath)
        ?.reload()
        .catch(() => undefined);
    });
    const [, memberResults] = await Promise.all([
      Promise.all(configRefreshes),
      Promise.all(memberChanges.map((uri) => this.#handleSchemaMemberChange(uri))),
    ]);
    if (
      this.#capabilities.pullDiagnostics &&
      this.#capabilities.diagnosticsRefresh &&
      (changedConfigPaths.size > 0 || memberResults.some(Boolean))
    ) {
      void this.#connection.languages.diagnostics.refresh();
    }
  }

  #projectForConfig(configPath: string): Project {
    let project = this.#projectsByConfig.get(configPath);
    if (project === undefined) {
      project = new Project(configPath, {
        documents: this.#documents,
        connection: this.#connection,
        pullDiagnostics: this.#capabilities.pullDiagnostics,
        watchedFilesRegistration: this.#capabilities.watchedFilesRegistration,
        nextSequence: () => ++this.#eventSequence,
        unmanage: (uri) => {
          if (uri === undefined) this.#unmanageDocuments(configPath);
          else this.#projectsByDocument.delete(canonicalFileIdentity(uri));
        },
      });
      this.#projectsByConfig.set(configPath, project);
    }
    return project;
  }

  #unmanageDocuments(configPath: string): void {
    for (const document of this.#documents.openDocuments()) {
      if (this.associatedProject(document.uri)?.configPath === configPath) {
        this.#projectsByDocument.delete(canonicalFileIdentity(document.uri));
      }
    }
  }

  async #publishForDocument(uri: string): Promise<void> {
    const project = await this.nearestProject(uri);
    await project?.publishForDocument(uri);
  }

  async #handleSchemaMemberChange(uri: string): Promise<boolean> {
    const sequence = ++this.#eventSequence;
    this.#documents.invalidate(uri);
    const filePath = filePathFromUri(uri);
    if (filePath === undefined) return false;
    let configPath: string | undefined;
    try {
      configPath = await findNearestConfigPathForFile(filePath);
    } catch {
      return false;
    }
    if (configPath === undefined) return false;
    return this.#projectsByConfig.get(configPath)?.refreshMembership(uri, sequence) ?? false;
  }
}

function filePathFromUri(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}
