import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { InternalError } from '@internal/utils/internal-error';
import type {
  OptionalVersionedTextDocumentIdentifier,
  TextDocumentContentChangeEvent,
  TextDocumentItem,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentSnapshot } from './document-snapshot';
import { canonicalFileIdentity, normalizeFileUri } from './schema-inputs';

interface OverlayEntry {
  readonly origin: 'overlay';
  readonly document: TextDocument;
  readonly snapshot: DocumentSnapshot;
}

interface DiskEntry {
  readonly origin: 'disk';
  readonly snapshot: DocumentSnapshot;
}

type StoreEntry = OverlayEntry | DiskEntry;

function readDiskEntry(path: string, uri: string): DiskEntry | undefined {
  try {
    const text = readFileSync(path, 'utf8');
    return {
      origin: 'disk',
      snapshot: new DocumentSnapshot(uri, text),
    };
  } catch {
    return undefined;
  }
}

export class DocumentStore {
  private readonly entries = new Map<string, StoreEntry>();
  invalidateTree(uri: string): void {
    const root = canonicalFileIdentity(uri);
    for (const [identity, entry] of this.entries) {
      if (entry.origin === 'disk' && (identity === root || identity.startsWith(`${root}${sep}`))) {
        this.entries.delete(identity);
      }
    }
  }

  readonly getOpenDocument = (uri: string): TextDocument | undefined => {
    const entry = this.entries.get(canonicalFileIdentity(uri));
    return entry?.origin === 'overlay' ? entry.document : undefined;
  };

  openDocuments(): readonly TextDocument[] {
    const documents: TextDocument[] = [];
    for (const entry of this.entries.values()) {
      if (entry.origin === 'overlay') documents.push(entry.document);
    }
    return documents;
  }

  text(uri: string): string | undefined {
    return this.readSnapshot(uri)?.text;
  }

  readonly readSnapshot = (uri: string): DocumentSnapshot | undefined => {
    const identity = canonicalFileIdentity(uri);
    const entry = this.entries.get(identity);
    if (entry !== undefined) return entry.snapshot;
    const fresh = readDiskEntry(identity, normalizeFileUri(uri));
    if (fresh === undefined) {
      this.entries.delete(identity);
      return undefined;
    }
    this.entries.set(identity, fresh);
    return fresh.snapshot;
  };

  invalidate(uri: string): void {
    const identity = canonicalFileIdentity(uri);
    if (this.entries.get(identity)?.origin === 'disk') {
      this.entries.delete(identity);
    }
  }

  open(item: TextDocumentItem): TextDocument {
    const uri = normalizeFileUri(item.uri);
    const document = TextDocument.create(uri, item.languageId, item.version, item.text);
    this.entries.set(canonicalFileIdentity(item.uri), {
      origin: 'overlay',
      document,
      snapshot: new DocumentSnapshot(uri, item.text),
    });
    return document;
  }

  change(
    identifier: OptionalVersionedTextDocumentIdentifier,
    changes: TextDocumentContentChangeEvent[],
  ): TextDocument | undefined {
    if (changes.length === 0) return undefined;
    const { uri, version } = identifier;
    if (version === null || version === undefined) {
      throw new InternalError(
        `Received document change event for ${uri} without valid version identifier`,
      );
    }
    const document = this.getOpenDocument(uri);
    if (document === undefined) return undefined;
    const updated = TextDocument.update(document, changes, version);
    this.entries.set(canonicalFileIdentity(uri), {
      origin: 'overlay',
      document: updated,
      snapshot: new DocumentSnapshot(updated.uri, updated.getText()),
    });
    return updated;
  }

  close(uri: string): TextDocument | undefined {
    const document = this.getOpenDocument(uri);
    this.entries.delete(canonicalFileIdentity(uri));
    return document;
  }
}
