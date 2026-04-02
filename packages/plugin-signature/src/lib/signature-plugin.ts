import { BasePlugin, createEmitter, createScopedEmitter, PluginRegistry } from '@embedpdf/core';
import { uuidV4 } from '@embedpdf/models';
import { AnnotationCapability, AnnotationPlugin } from '@embedpdf/plugin-annotation';
import {
  SignatureCapability,
  SignatureScope,
  SignatureEntry,
  SignatureFieldDefinition,
  SignatureFieldKind,
  SignatureCreationType,
  SignaturePluginConfig,
  SignatureState,
  SignatureBinaryData,
  ActivePlacementInfo,
  ActivePlacementChangeEvent,
  ExportableSignatureEntry,
  ExportableSignatureFieldDefinition,
} from './types';
import { addSignatureEntry, removeSignatureEntry, SignatureAction } from './actions';
import { SIGNATURE_PLUGIN_ID } from './manifest';
import { SIGNATURE_STAMP_TOOL_ID, SIGNATURE_INK_TOOL_ID, signatureTools } from './tools';

export class SignaturePlugin extends BasePlugin<
  SignaturePluginConfig,
  SignatureCapability,
  SignatureState,
  SignatureAction
> {
  static readonly id = SIGNATURE_PLUGIN_ID;

  private readonly entries = new Map<string, SignatureEntry>();
  private readonly binaryCache = new Map<string, ArrayBuffer>();
  private readonly entriesChange$ = createEmitter<SignatureEntry[]>();
  private readonly activePlacement$ = createScopedEmitter<
    ActivePlacementInfo | null,
    ActivePlacementChangeEvent,
    string
  >((documentId, activePlacement) => ({ documentId, activePlacement }));

  private annotation: AnnotationCapability | null = null;
  private toolChangeUnsubscribe: (() => void) | null = null;
  private currentGhostUrl: string | null = null;

  constructor(
    id: string,
    registry: PluginRegistry,
    private config: SignaturePluginConfig,
  ) {
    super(id, registry);

    this.annotation = registry.getPlugin<AnnotationPlugin>('annotation')?.provides() ?? null;
    if (this.annotation) {
      for (const tool of signatureTools) {
        this.annotation.addTool(tool);
      }
      this.toolChangeUnsubscribe = this.annotation.onActiveToolChange(({ documentId, tool }) => {
        if (tool?.id !== SIGNATURE_STAMP_TOOL_ID && tool?.id !== SIGNATURE_INK_TOOL_ID) {
          this.revokeGhostUrl();
          this.activePlacement$.emit(documentId, null);
        }
      });
    }
  }

  async initialize(): Promise<void> {}

  protected buildCapability(): SignatureCapability {
    return {
      mode: this.config.mode,
      getEntries: () => this.getEntries(),
      addEntry: (entry, binaryData) => this.addEntry(entry, binaryData),
      removeEntry: (id) => this.removeEntry(id),
      loadEntries: (entries, binaryData) => this.loadEntries(entries, binaryData),
      exportEntries: () => this.exportEntries(),
      onEntriesChange: this.entriesChange$.on,
      forDocument: (documentId) => this.createSignatureScope(documentId),
      onActivePlacementChange: this.activePlacement$.onGlobal,
    };
  }

  getEntries(): SignatureEntry[] {
    return Array.from(this.entries.values());
  }

  addEntry(
    entry: Omit<SignatureEntry, 'id' | 'createdAt'>,
    binaryData?: SignatureBinaryData,
  ): string {
    const id = uuidV4();
    const fullEntry: SignatureEntry = {
      ...entry,
      id,
      createdAt: Date.now(),
    };

    this.entries.set(id, fullEntry);

    if (binaryData?.signatureImageData) {
      this.binaryCache.set(`${id}:${SignatureFieldKind.Signature}`, binaryData.signatureImageData);
    }
    if (binaryData?.initialsImageData) {
      this.binaryCache.set(`${id}:${SignatureFieldKind.Initials}`, binaryData.initialsImageData);
    }

    this.dispatch(addSignatureEntry(id));
    this.emitEntriesChange();

    return id;
  }

  removeEntry(id: string): void {
    if (!this.entries.has(id)) return;

    this.entries.delete(id);
    this.binaryCache.delete(`${id}:${SignatureFieldKind.Signature}`);
    this.binaryCache.delete(`${id}:${SignatureFieldKind.Initials}`);

    this.dispatch(removeSignatureEntry(id));
    this.emitEntriesChange();
  }

  loadEntries(entries: SignatureEntry[], binaryData?: Map<string, ArrayBuffer>): void {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
      this.dispatch(addSignatureEntry(entry.id));
    }

    if (binaryData) {
      for (const [key, value] of binaryData) {
        this.binaryCache.set(key, value);
      }
    }

    this.emitEntriesChange();
  }

  exportEntries(): ExportableSignatureEntry[] {
    return this.getEntries().map((entry) => {
      const exportEntry: ExportableSignatureEntry = {
        id: entry.id,
        createdAt: entry.createdAt,
        signature: this.exportField(entry.id, SignatureFieldKind.Signature, entry.signature),
      };

      if (entry.initials) {
        exportEntry.initials = this.exportField(
          entry.id,
          SignatureFieldKind.Initials,
          entry.initials,
        );
      }

      return exportEntry;
    });
  }

  private exportField(
    entryId: string,
    kind: SignatureFieldKind,
    field: SignatureFieldDefinition,
  ): ExportableSignatureFieldDefinition {
    const imageData = this.binaryCache.get(`${entryId}:${kind}`);
    return { ...field, imageData };
  }

  private createSignatureScope(documentId: string): SignatureScope {
    return {
      activateSignaturePlacement: (entryId) =>
        this.activatePlacement(documentId, entryId, SignatureFieldKind.Signature),
      activateInitialsPlacement: (entryId) =>
        this.activatePlacement(documentId, entryId, SignatureFieldKind.Initials),
      deactivatePlacement: () => this.deactivatePlacement(documentId),
      getActivePlacement: () => this.activePlacement$.getValue(documentId) ?? null,
      onActivePlacementChange: this.activePlacement$.forScope(documentId),
    };
  }

  private activatePlacement(documentId: string, entryId: string, kind: SignatureFieldKind): void {
    const entry = this.entries.get(entryId);
    if (!entry || !this.annotation) return;

    const field = kind === SignatureFieldKind.Initials ? entry.initials : entry.signature;
    if (!field) return;

    this.revokeGhostUrl();

    if (field.creationType === SignatureCreationType.Draw && field.inkData) {
      const defaultSize = this.config.defaultSize ?? { width: 150, height: 50 };
      const scale = Math.min(
        defaultSize.width / field.inkData.size.width,
        defaultSize.height / field.inkData.size.height,
      );
      const targetSize = {
        width: field.inkData.size.width * scale,
        height: field.inkData.size.height * scale,
      };

      this.annotation.setActiveTool(SIGNATURE_INK_TOOL_ID, {
        inkData: field.inkData,
        targetSize,
        entryId,
        kind,
      });
    } else {
      const imageData = this.binaryCache.get(`${entryId}:${kind}`);
      if (!imageData) return;

      const ghostUrl = URL.createObjectURL(
        new Blob([imageData], { type: field.imageMimeType ?? 'image/png' }),
      );
      this.currentGhostUrl = ghostUrl;

      const defaultSize = this.config.defaultSize ?? { width: 150, height: 50 };
      let targetSize = defaultSize;
      if (field.imageSize) {
        const scale = Math.min(
          defaultSize.width / field.imageSize.width,
          defaultSize.height / field.imageSize.height,
        );
        targetSize = {
          width: field.imageSize.width * scale,
          height: field.imageSize.height * scale,
        };
      }

      this.annotation.setActiveTool(SIGNATURE_STAMP_TOOL_ID, {
        imageData,
        ghostUrl,
        targetSize,
        entryId,
        kind,
      });
    }

    this.activePlacement$.emit(documentId, { entryId, kind });
  }

  private deactivatePlacement(documentId: string): void {
    if (!this.annotation) return;
    this.annotation.setActiveTool(null);
    this.revokeGhostUrl();
    this.activePlacement$.emit(documentId, null);
  }

  private revokeGhostUrl(): void {
    if (this.currentGhostUrl) {
      URL.revokeObjectURL(this.currentGhostUrl);
      this.currentGhostUrl = null;
    }
  }

  private emitEntriesChange(): void {
    this.entriesChange$.emit(this.getEntries());
  }

  override async destroy(): Promise<void> {
    this.revokeGhostUrl();
    this.toolChangeUnsubscribe?.();
    this.entries.clear();
    this.binaryCache.clear();
  }
}
