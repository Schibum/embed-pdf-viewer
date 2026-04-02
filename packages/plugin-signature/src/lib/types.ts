import { BasePluginConfig, EventHook } from '@embedpdf/core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum SignatureMode {
  SignatureOnly = 'signature-only',
  SignatureAndInitials = 'signature-and-initials',
}

export enum SignatureCreationType {
  Draw = 'draw',
  Type = 'type',
  Upload = 'upload',
}

export enum SignatureFieldKind {
  Signature = 'signature',
  Initials = 'initials',
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface SignatureInkData {
  inkList: Array<{ points: Array<{ x: number; y: number }> }>;
  strokeWidth: number;
  strokeColor: string;
  size: { width: number; height: number };
}

export interface SignatureFieldDefinition {
  creationType: SignatureCreationType;
  label?: string;
  inkData?: SignatureInkData;
  imageMimeType?: string;
  imageSize?: { width: number; height: number };
  previewDataUrl: string;
}

export interface SignatureEntry {
  id: string;
  createdAt: number;
  signature: SignatureFieldDefinition;
  initials?: SignatureFieldDefinition;
}

export interface ExportableSignatureEntry {
  id: string;
  createdAt: number;
  signature: ExportableSignatureFieldDefinition;
  initials?: ExportableSignatureFieldDefinition;
}

export interface ExportableSignatureFieldDefinition extends SignatureFieldDefinition {
  imageData?: ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Plugin config
// ---------------------------------------------------------------------------

export interface SignaturePluginConfig extends BasePluginConfig {
  mode: SignatureMode;
  defaultSize?: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SignatureState {
  entryIds: string[];
}

// ---------------------------------------------------------------------------
// Tool context types (declaration-merged into ToolContextMap)
// ---------------------------------------------------------------------------

export interface SignatureStampToolContext {
  imageData: ArrayBuffer;
  ghostUrl: string;
  targetSize: { width: number; height: number };
  entryId: string;
  kind: SignatureFieldKind;
}

export interface SignatureInkToolContext {
  inkData: SignatureInkData;
  targetSize: { width: number; height: number };
  entryId: string;
  kind: SignatureFieldKind;
}

declare module '@embedpdf/plugin-annotation' {
  interface ToolContextMap {
    signatureStamp: SignatureStampToolContext;
    signatureInk: SignatureInkToolContext;
  }
}

// ---------------------------------------------------------------------------
// Capability / Scope
// ---------------------------------------------------------------------------

export interface ActivePlacementInfo {
  entryId: string;
  kind: SignatureFieldKind;
}

export interface ActivePlacementChangeEvent {
  documentId: string;
  activePlacement: ActivePlacementInfo | null;
}

export interface SignatureScope {
  activateSignaturePlacement(entryId: string): void;
  activateInitialsPlacement(entryId: string): void;
  deactivatePlacement(): void;
  getActivePlacement(): ActivePlacementInfo | null;
  onActivePlacementChange: EventHook<ActivePlacementInfo | null>;
}

export interface SignatureCapability {
  readonly mode: SignatureMode;
  getEntries(): SignatureEntry[];
  addEntry(
    entry: Omit<SignatureEntry, 'id' | 'createdAt'>,
    binaryData?: SignatureBinaryData,
  ): string;
  removeEntry(id: string): void;
  loadEntries(entries: SignatureEntry[], binaryData?: Map<string, ArrayBuffer>): void;
  exportEntries(): ExportableSignatureEntry[];
  onEntriesChange: EventHook<SignatureEntry[]>;
  forDocument(documentId: string): SignatureScope;
  onActivePlacementChange: EventHook<ActivePlacementChangeEvent>;
}

export interface SignatureBinaryData {
  signatureImageData?: ArrayBuffer;
  initialsImageData?: ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Component prop types
// ---------------------------------------------------------------------------

export interface SignatureDrawPadProps {
  onResult: (result: SignatureFieldDefinition | null) => void;
  strokeColor?: string;
  strokeWidth?: number;
  width?: number;
  height?: number;
  className?: string;
}

export interface SignatureTypePadProps {
  onResult: (result: (SignatureFieldDefinition & { imageData?: ArrayBuffer }) | null) => void;
  fonts?: Array<{ name: string; family: string }>;
  defaultFont?: string;
  fontSize?: number;
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

export interface SignatureUploadPadProps {
  onResult: (result: (SignatureFieldDefinition & { imageData?: ArrayBuffer }) | null) => void;
  accept?: string;
  width?: number;
  height?: number;
  className?: string;
}
