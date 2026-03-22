import { BasePluginConfig, EventHook } from '@embedpdf/core';
import {
  PdfErrorReason,
  PdfRenderPageAnnotationOptions,
  PdfTask,
  PdfWidgetAnnoField,
  PdfWidgetAnnoObject,
  Task,
} from '@embedpdf/models';

export interface FormPluginConfig extends BasePluginConfig {}

export interface FieldGroupEntry {
  annotationId: string;
  pageIndex: number;
}

export interface RenderWidgetOptions {
  pageIndex: number;
  annotation: PdfWidgetAnnoObject;
  options?: PdfRenderPageAnnotationOptions;
}

export interface FormDocumentState {
  selectedFieldId: string | null;
}

export interface FormState {
  documents: Record<string, FormDocumentState>;
}

export interface FormStateChangeEvent {
  documentId: string;
  state: FormDocumentState;
}

export interface FieldValueChangeEvent {
  documentId: string;
  pageIndex: number;
  annotationId: string;
  widget: PdfWidgetAnnoObject;
}

export type RenameFieldResult =
  | { outcome: 'renamed' }
  | { outcome: 'no-op' }
  | { outcome: 'conflict'; targetAnnotationId: string; fieldName: string };

export interface FormScope {
  getPageFormAnnoWidgets(pageIndex: number): PdfTask<PdfWidgetAnnoObject[]>;
  setFormFieldValues(
    pageIndex: number,
    annotation: PdfWidgetAnnoObject,
    newField: PdfWidgetAnnoField,
  ): PdfTask<boolean>;
  renameField(annotationId: string, name: string): PdfTask<RenameFieldResult>;
  shareField(annotationId: string, targetAnnotationId: string): PdfTask<boolean>;
  renderWidget(options: RenderWidgetOptions): Task<Blob, PdfErrorReason>;
  selectField(annotationId: string, options?: { scroll?: boolean }): void;
  deselectField(): void;
  getSelectedFieldId(): string | null;
  selectNextField(options?: { scroll?: boolean }): void;
  selectPreviousField(options?: { scroll?: boolean }): void;
  activateField(): void;
  getState(): FormDocumentState;
  /** Get all widget entries sharing the same logical field (including the given annotation) */
  getFieldGroup(annotationId: string): FieldGroupEntry[];
  /** Get sibling widget entries sharing the same logical field (excluding the given annotation) */
  getFieldSiblings(annotationId: string): FieldGroupEntry[];
  onStateChange: EventHook<FormDocumentState>;
  onFieldValueChange: EventHook<FieldValueChangeEvent>;
}

export interface FormCapability {
  getPageFormAnnoWidgets(pageIndex: number, documentId?: string): PdfTask<PdfWidgetAnnoObject[]>;
  setFormFieldValues(
    pageIndex: number,
    annotation: PdfWidgetAnnoObject,
    newField: PdfWidgetAnnoField,
    documentId?: string,
  ): PdfTask<boolean>;
  renameField(annotationId: string, name: string, documentId?: string): PdfTask<RenameFieldResult>;
  shareField(
    annotationId: string,
    targetAnnotationId: string,
    documentId?: string,
  ): PdfTask<boolean>;
  renderWidget(options: RenderWidgetOptions, documentId?: string): Task<Blob, PdfErrorReason>;
  selectField(annotationId: string, options?: { scroll?: boolean }, documentId?: string): void;
  deselectField(documentId?: string): void;
  getSelectedFieldId(documentId?: string): string | null;
  selectNextField(options?: { scroll?: boolean }, documentId?: string): void;
  selectPreviousField(options?: { scroll?: boolean }, documentId?: string): void;
  activateField(documentId?: string): void;
  getState(documentId?: string): FormDocumentState;
  /** Get all widget entries sharing the same logical field (including the given annotation) */
  getFieldGroup(annotationId: string, documentId?: string): FieldGroupEntry[];
  /** Get sibling widget entries sharing the same logical field (excluding the given annotation) */
  getFieldSiblings(annotationId: string, documentId?: string): FieldGroupEntry[];
  forDocument(documentId: string): FormScope;
  onStateChange: EventHook<FormStateChangeEvent>;
  onFieldValueChange: EventHook<FieldValueChangeEvent>;
}
