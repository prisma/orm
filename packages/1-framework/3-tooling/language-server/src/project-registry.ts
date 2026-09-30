import { fileURLToPath, pathToFileURL } from 'node:url';
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
  #disposed = false;
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
    if (this.#disposed) return undefined;
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
    if (this.#disposed || configPath === undefined) return undefined;
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
    }
  }

  watchedFilesChanged(changes: readonly FileEvent[]): void {
    for (const project of this.#projectsByConfig.values()) {
      project.filesChanged(
        changes
          .filter((change) => {
            const path = filePathFromUri(change.uri);
            return (
              path !== undefined &&
              (!path.endsWith(CONFIG_FILENAME) ||
                canonicalFileIdentity(change.uri) ===
                  canonicalFileIdentity(pathToFileURL(project.configPath).toString()))
            );
          })
          .map((change) => change.uri),
      );
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    await Promise.all(Array.from(this.#projectsByConfig.values(), (project) => project.dispose()));
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
        refreshDiagnostics: () => {
          if (this.#capabilities.pullDiagnostics && this.#capabilities.diagnosticsRefresh) {
            void this.#connection.languages.diagnostics.refresh();
          }
        },
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
}

function filePathFromUri(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}
