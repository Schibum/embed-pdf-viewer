import {
  BasePlugin,
  createBehaviorEmitter,
  createEmitter,
  Listener,
  PluginRegistry,
} from '@embedpdf/core';
import {
  FieldGroupEntry,
  FieldValueChangeEvent,
  FormCapability,
  FormDocumentState,
  FormPluginConfig,
  FormScope,
  FormState,
  FormStateChangeEvent,
  RenderWidgetOptions,
} from './types';
import {
  FormAction,
  initFormState,
  cleanupFormState,
  selectField as selectFieldAction,
  deselectField as deselectFieldAction,
} from './actions';
import {
  PdfAnnotationObject,
  PdfAnnotationSubtype,
  PdfDocumentObject,
  PdfErrorCode,
  PdfErrorReason,
  PDF_FORM_FIELD_TYPE,
  PdfCheckboxWidgetAnnoField,
  PdfTask,
  PdfTaskHelper,
  PdfRadioButtonWidgetAnnoField,
  PdfWidgetAnnoField,
  PdfWidgetAnnoObject,
  Task,
  TaskSequence,
} from '@embedpdf/models';
import {
  AnnotationCapability,
  AnnotationEvent,
  AnnotationPlugin,
} from '@embedpdf/plugin-annotation';
import { Command, HistoryCapability, HistoryPlugin } from '@embedpdf/plugin-history';
import { initialDocumentState } from './reducer';
import { formTools } from './tools';

export class FormPlugin extends BasePlugin<
  FormPluginConfig,
  FormCapability,
  FormState,
  FormAction
> {
  static readonly id = 'form' as const;

  private readonly FORM_HISTORY_TOPIC = 'form-fields';

  private annotation: AnnotationCapability | null = null;
  private history: HistoryCapability | null = null;

  private readonly state$ = createBehaviorEmitter<FormStateChangeEvent>();
  private readonly fieldValueChange$ = createEmitter<FieldValueChangeEvent>();

  /** Per-document logical field index: documentId → (fieldKey → FieldGroupEntry[]) */
  private readonly fieldGroupIndex = new Map<string, Map<string, FieldGroupEntry[]>>();

  /** IDs currently being propagated to siblings; prevents recursive loops */
  private readonly propagationInProgress = new Set<string>();

  constructor(id: string, registry: PluginRegistry, _config: FormPluginConfig) {
    super(id, registry);

    this.annotation = registry.getPlugin<AnnotationPlugin>('annotation')?.provides() ?? null;
    this.history = registry.getPlugin<HistoryPlugin>(HistoryPlugin.id)?.provides() ?? null;

    if (this.annotation) {
      for (const tool of formTools) {
        this.annotation.addTool(tool);
      }
      this.annotation.onAnnotationEvent((event) => this.handleAnnotationEvent(event));
    }
  }

  async initialize(): Promise<void> {}

  protected override onDocumentLoadingStarted(documentId: string): void {
    this.dispatch(initFormState(documentId, { ...initialDocumentState }));
  }

  protected override onDocumentClosed(documentId: string): void {
    this.dispatch(cleanupFormState(documentId));
    this.fieldGroupIndex.delete(documentId);
  }

  override onStoreUpdated(prev: FormState, next: FormState): void {
    for (const documentId in next.documents) {
      const prevDoc = prev.documents[documentId];
      const nextDoc = next.documents[documentId];
      if (prevDoc !== nextDoc) {
        this.state$.emit({ documentId, state: nextDoc });
      }
    }
  }

  protected buildCapability(): FormCapability {
    return {
      getPageFormAnnoWidgets: (pageIndex, documentId?) =>
        this.getPageFormAnnoWidgets(pageIndex, documentId),
      setFormFieldValues: (pageIndex, annotation, newField, documentId?) =>
        this.setFormFieldValues(pageIndex, annotation, newField, documentId),
      renameField: (annotationId, name, documentId?) =>
        this.renameFieldMethod(annotationId, name, documentId),
      shareField: (annotationId, targetAnnotationId, documentId?) =>
        this.shareFieldMethod(annotationId, targetAnnotationId, documentId),
      renderWidget: (options, documentId?) => this.renderWidget(options, documentId),
      selectField: (annotationId, documentId?) => this.selectFieldMethod(annotationId, documentId),
      deselectField: (documentId?) => this.deselectFieldMethod(documentId),
      getSelectedFieldId: (documentId?) => this.getSelectedFieldId(documentId),
      getState: (documentId?) => this.getDocumentState(documentId),
      getFieldGroup: (annotationId, documentId?) => this.getFieldGroup(annotationId, documentId),
      getFieldSiblings: (annotationId, documentId?) =>
        this.getFieldSiblings(annotationId, documentId),
      forDocument: (documentId) => this.createFormScope(documentId),
      onStateChange: this.state$.on,
      onFieldValueChange: this.fieldValueChange$.on,
    };
  }

  private createFormScope(documentId: string): FormScope {
    return {
      getPageFormAnnoWidgets: (pageIndex) => this.getPageFormAnnoWidgets(pageIndex, documentId),
      setFormFieldValues: (pageIndex, annotation, newField) =>
        this.setFormFieldValues(pageIndex, annotation, newField, documentId),
      renameField: (annotationId, name) => this.renameFieldMethod(annotationId, name, documentId),
      shareField: (annotationId, targetAnnotationId) =>
        this.shareFieldMethod(annotationId, targetAnnotationId, documentId),
      renderWidget: (options) => this.renderWidget(options, documentId),
      selectField: (annotationId) => this.selectFieldMethod(annotationId, documentId),
      deselectField: () => this.deselectFieldMethod(documentId),
      getSelectedFieldId: () => this.getSelectedFieldId(documentId),
      getState: () => this.getDocumentState(documentId),
      getFieldGroup: (annotationId) => this.getFieldGroup(annotationId, documentId),
      getFieldSiblings: (annotationId) => this.getFieldSiblings(annotationId, documentId),
      onStateChange: (listener: Listener<FormDocumentState>) =>
        this.state$.on((event) => {
          if (event.documentId === documentId) listener(event.state);
        }),
      onFieldValueChange: (listener: Listener<FieldValueChangeEvent>) =>
        this.fieldValueChange$.on((event) => {
          if (event.documentId === documentId) listener(event);
        }),
    };
  }

  private handleAnnotationEvent(event: AnnotationEvent): void {
    switch (event.type) {
      case 'loaded':
        this.buildFieldGroupIndex(event.documentId);
        break;

      case 'create':
      case 'delete': {
        if (event.annotation.type !== PdfAnnotationSubtype.WIDGET) break;
        this.buildFieldGroupIndex(event.documentId);
        break;
      }

      case 'update': {
        if (!event.committed) break;
        const anno = event.annotation;
        if (anno.type !== PdfAnnotationSubtype.WIDGET) break;

        if (this.propagationInProgress.has(anno.id)) {
          this.propagationInProgress.delete(anno.id);
          break;
        }

        const patch = event.patch as Partial<PdfWidgetAnnoObject>;

        this.buildFieldGroupIndex(event.documentId);
        this.propagateFieldLevelChanges(event.documentId, anno, patch);
        break;
      }
    }
  }

  private propagateFieldLevelChanges(
    documentId: string,
    annotation: PdfAnnotationObject,
    patch: Partial<PdfWidgetAnnoObject>,
  ): void {
    if (!this.annotation || !patch.field) return;

    const fieldPatch = patch.field;

    const siblings = this.getFieldSiblings(annotation.id, documentId);
    if (siblings.length === 0) return;

    const siblingPatches: Array<{
      pageIndex: number;
      id: string;
      patch: Partial<PdfAnnotationObject>;
    }> = [];

    for (const sibling of siblings) {
      this.propagationInProgress.add(sibling.annotationId);
      siblingPatches.push({
        pageIndex: sibling.pageIndex,
        id: sibling.annotationId,
        patch: { field: { ...fieldPatch } } as Partial<PdfAnnotationObject>,
      });
    }

    this.annotation.forDocument(documentId).updateAnnotations(siblingPatches);
  }

  private buildFieldGroupIndex(documentId: string): void {
    if (!this.annotation) return;
    const annoState = this.annotation.forDocument(documentId).getState();
    if (!annoState) return;

    const idx = new Map<string, FieldGroupEntry[]>();

    for (const [pageStr, uids] of Object.entries(annoState.pages)) {
      const pageIndex = Number(pageStr);
      for (const uid of uids) {
        const tracked = annoState.byUid[uid];
        if (!tracked || tracked.object.type !== PdfAnnotationSubtype.WIDGET) continue;
        const widget = tracked.object as PdfWidgetAnnoObject;
        const fieldKey = this.getFieldKey(widget.field);
        if (!fieldKey) continue;

        const group = idx.get(fieldKey) ?? [];
        group.push({ annotationId: uid, pageIndex });
        idx.set(fieldKey, group);
      }
    }

    this.fieldGroupIndex.set(documentId, idx);
  }

  private getDocumentState(documentId?: string): FormDocumentState {
    const id = documentId ?? this.getActiveDocumentId();
    return this.state.documents[id] ?? { ...initialDocumentState };
  }

  // ─────────────────────────────────────────────────────────
  // Field Group Index
  // ─────────────────────────────────────────────────────────

  private getDocIndex(documentId: string): Map<string, FieldGroupEntry[]> {
    let idx = this.fieldGroupIndex.get(documentId);
    if (!idx) {
      idx = new Map();
      this.fieldGroupIndex.set(documentId, idx);
    }
    return idx;
  }

  private getFieldKey(field: PdfWidgetAnnoField): string | null {
    if (typeof field.fieldObjectId === 'number' && field.fieldObjectId > 0) {
      return `field:${field.fieldObjectId}`;
    }

    const normalizedName = field.name.trim();
    if (!normalizedName) return null;

    return `legacy:${field.type}:${normalizedName}`;
  }

  private resolveWidgetAnnotation(
    annotationId: string,
    documentId: string,
  ): PdfWidgetAnnoObject | null {
    if (!this.annotation) return null;

    const annoState = this.annotation.forDocument(documentId).getState();
    const tracked = annoState?.byUid[annotationId];
    if (!tracked || tracked.object.type !== PdfAnnotationSubtype.WIDGET) {
      return null;
    }

    return tracked.object as PdfWidgetAnnoObject;
  }

  public getFieldGroup(annotationId: string, documentId?: string): FieldGroupEntry[] {
    const docId = documentId ?? this.getActiveDocumentId();
    const widget = this.resolveWidgetAnnotation(annotationId, docId);
    if (!widget) return [];

    const fieldKey = this.getFieldKey(widget.field);
    if (!fieldKey) {
      return [{ annotationId: widget.id, pageIndex: widget.pageIndex }];
    }

    return (
      this.getDocIndex(docId).get(fieldKey) ?? [
        { annotationId: widget.id, pageIndex: widget.pageIndex },
      ]
    );
  }

  public getFieldSiblings(annotationId: string, documentId?: string): FieldGroupEntry[] {
    return this.getFieldGroup(annotationId, documentId).filter(
      (e) => e.annotationId !== annotationId,
    );
  }

  private isToggleField(
    field: PdfWidgetAnnoField,
  ): field is PdfCheckboxWidgetAnnoField | PdfRadioButtonWidgetAnnoField {
    return (
      field.type === PDF_FORM_FIELD_TYPE.CHECKBOX || field.type === PDF_FORM_FIELD_TYPE.RADIOBUTTON
    );
  }

  private shouldRegenerateWidgetAppearances(field: PdfWidgetAnnoField): boolean {
    return !this.isToggleField(field);
  }

  private getFieldBatchTarget(
    batch: Map<string, { widget: PdfWidgetAnnoObject; pageIndex: number }>,
  ): { widget: PdfWidgetAnnoObject; pageIndex: number } | undefined {
    const entries = [...batch.values()];
    const checkedToggleEntry = entries.find(
      (entry) => this.isToggleField(entry.widget.field) && entry.widget.field.isChecked,
    );
    return checkedToggleEntry ?? entries[0];
  }

  private async readFieldWidgets(
    doc: PdfDocumentObject,
    groupEntries: FieldGroupEntry[],
    seq: TaskSequence<PdfErrorReason, unknown>,
    regenerateAppearances: boolean,
  ): Promise<Map<string, { widget: PdfWidgetAnnoObject; pageIndex: number }>> {
    const pageSet = new Set(groupEntries.map((entry) => entry.pageIndex));
    const memberIds = new Set(groupEntries.map((entry) => entry.annotationId));
    const batch = new Map<string, { widget: PdfWidgetAnnoObject; pageIndex: number }>();

    for (const pageIndex of pageSet) {
      const page = doc.pages.find((entry) => entry.index === pageIndex);
      if (!page) continue;

      const pageMemberIds = groupEntries
        .filter((entry) => entry.pageIndex === pageIndex)
        .map((entry) => entry.annotationId);

      if (regenerateAppearances) {
        await seq.run(() => this.engine.regenerateWidgetAppearances(doc, page, pageMemberIds));
      }

      const widgets = await seq.run(() => this.engine.getPageAnnoWidgets(doc, page));
      for (const widget of widgets) {
        if (memberIds.has(widget.id)) {
          batch.set(widget.id, { widget, pageIndex });
        }
      }
    }

    return batch;
  }

  private syncFieldBatch(
    documentId: string,
    batch: Map<string, { widget: PdfWidgetAnnoObject; pageIndex: number }>,
    options: { emitFieldValueChanges?: boolean } = {},
  ): void {
    if (!this.annotation) return;

    for (const [id, { widget, pageIndex }] of batch) {
      this.annotation.syncAnnotationObject(id, widget, documentId);
      this.annotation.invalidatePageAppearances(pageIndex, documentId);

      if (options.emitFieldValueChanges) {
        this.fieldValueChange$.emit({
          documentId,
          pageIndex,
          annotationId: id,
          widget,
        });
      }
    }

    this.buildFieldGroupIndex(documentId);
  }

  private resolveWidgetPage(
    annotationId: string,
    documentId: string,
    doc: PdfDocumentObject,
  ): { widget: PdfWidgetAnnoObject; page: PdfDocumentObject['pages'][number] } | null {
    const widget = this.resolveWidgetAnnotation(annotationId, documentId);
    if (!widget) return null;

    const page = doc.pages.find((entry) => entry.index === widget.pageIndex);
    if (!page) return null;

    return { widget, page };
  }

  private getPageFormAnnoWidgets(
    pageIndex: number,
    documentId?: string,
  ): PdfTask<PdfWidgetAnnoObject[]> {
    const docState = this.getCoreDocumentOrThrow(documentId);
    const doc = docState.document;

    if (!doc) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.DocNotOpen,
        message: 'document is not open',
      });
    }

    const page = doc.pages.find((p) => p.index === pageIndex);
    if (!page) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.NotFound,
        message: 'page does not exist',
      });
    }

    return this.engine.getPageAnnoWidgets(doc, page);
  }

  private setFormFieldValues(
    pageIndex: number,
    annotation: PdfWidgetAnnoObject,
    newField: PdfWidgetAnnoField,
    documentId?: string,
  ): PdfTask<boolean> {
    const docId = documentId ?? this.getActiveDocumentId();
    const coreDoc = this.getCoreDocumentOrThrow(docId);
    const doc = coreDoc.document;

    if (!doc) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.DocNotOpen,
        message: 'document is not open',
      });
    }

    const page = doc.pages.find((p) => p.index === pageIndex);
    if (!page) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.NotFound,
        message: 'page does not exist',
      });
    }

    const resultTask = new Task<boolean, PdfErrorReason>();
    const seq = new TaskSequence(resultTask);

    seq.execute(
      async () => {
        // 1. Snapshot "before" state for the entire field group
        const groupEntries = this.getFieldGroup(annotation.id, docId);
        const beforeEntries = await this.readFieldWidgets(doc, groupEntries, seq, false);

        // 2. Apply field state change to the engine (PDFium propagates to all controls)
        await seq.run(() => this.engine.setFormFieldState(doc, page, annotation, newField));

        // 3. Re-read fresh state for all group members, regenerating AP only when needed
        const afterEntries = await this.readFieldWidgets(
          doc,
          groupEntries,
          seq,
          this.shouldRegenerateWidgetAppearances(newField),
        );

        // 5. Build and register history command
        let isFirstExecution = true;

        const applyToEngine = async (
          batch: Map<string, { widget: PdfWidgetAnnoObject; pageIndex: number }>,
        ) => {
          const target = this.getFieldBatchTarget(batch);
          if (!target) return;
          const pg = doc.pages.find((p) => p.index === target.pageIndex);
          if (!pg) return;
          await new Promise<void>((resolve) => {
            this.engine.setFormFieldState(doc, pg, target.widget, target.widget.field).wait(
              () => resolve(),
              () => resolve(),
            );
          });

          if (this.shouldRegenerateWidgetAppearances(target.widget.field)) {
            for (const pi of new Set([...batch.values()].map((entry) => entry.pageIndex))) {
              const p = doc.pages.find((pp) => pp.index === pi);
              if (!p) continue;
              const ids = [...batch.entries()]
                .filter(([, entry]) => entry.pageIndex === pi)
                .map(([id]) => id);
              await new Promise<void>((resolve) => {
                this.engine.regenerateWidgetAppearances(doc, p, ids).wait(
                  () => resolve(),
                  () => resolve(),
                );
              });
            }
          }
        };

        const command: Command = {
          execute: () => {
            const skipEngine = isFirstExecution;
            isFirstExecution = false;

            if (skipEngine) {
              this.syncFieldBatch(docId, afterEntries, { emitFieldValueChanges: true });
            } else {
              applyToEngine(afterEntries).then(() =>
                this.syncFieldBatch(docId, afterEntries, { emitFieldValueChanges: true }),
              );
            }
          },

          undo: () => {
            applyToEngine(beforeEntries).then(() =>
              this.syncFieldBatch(docId, beforeEntries, { emitFieldValueChanges: true }),
            );
          },
        };

        if (this.history) {
          this.history.forDocument(docId).register(command, this.FORM_HISTORY_TOPIC);
        } else {
          command.execute();
        }

        resultTask.resolve(true);
      },
      (err) => ({ code: PdfErrorCode.Unknown, message: String(err) }),
    );

    return resultTask;
  }

  private renameFieldMethod(
    annotationId: string,
    name: string,
    documentId?: string,
  ): PdfTask<boolean> {
    const docId = documentId ?? this.getActiveDocumentId();
    const normalizedName = name.trim();
    if (!normalizedName) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.Unknown,
        message: 'field name must not be empty',
      });
    }

    const coreDoc = this.getCoreDocumentOrThrow(docId);
    const doc = coreDoc.document;
    if (!doc) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.DocNotOpen,
        message: 'document is not open',
      });
    }

    const source = this.resolveWidgetPage(annotationId, docId, doc);
    if (!source) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.NotFound,
        message: 'widget annotation not found',
      });
    }

    if (source.widget.field.name === normalizedName) {
      return PdfTaskHelper.resolve(true);
    }

    const resultTask = new Task<boolean, PdfErrorReason>();
    const seq = new TaskSequence(resultTask);

    seq.execute(
      async () => {
        const groupEntries = this.getFieldGroup(annotationId, docId);
        await seq.run(() =>
          this.engine.renameWidgetField(doc, source.page, source.widget, normalizedName),
        );

        const syncedEntries = await this.readFieldWidgets(doc, groupEntries, seq, false);
        this.syncFieldBatch(docId, syncedEntries);
        resultTask.resolve(true);
      },
      (err) => ({ code: PdfErrorCode.Unknown, message: String(err) }),
    );

    return resultTask;
  }

  private shareFieldMethod(
    annotationId: string,
    targetAnnotationId: string,
    documentId?: string,
  ): PdfTask<boolean> {
    const docId = documentId ?? this.getActiveDocumentId();
    if (annotationId === targetAnnotationId) {
      return PdfTaskHelper.resolve(true);
    }

    const coreDoc = this.getCoreDocumentOrThrow(docId);
    const doc = coreDoc.document;
    if (!doc) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.DocNotOpen,
        message: 'document is not open',
      });
    }

    const source = this.resolveWidgetPage(annotationId, docId, doc);
    const target = this.resolveWidgetPage(targetAnnotationId, docId, doc);
    if (!source || !target) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.NotFound,
        message: 'widget annotation not found',
      });
    }

    if (source.widget.field.type !== target.widget.field.type) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.Unknown,
        message: 'cannot share fields with different widget types',
      });
    }

    if (
      source.widget.field.fieldObjectId &&
      target.widget.field.fieldObjectId &&
      source.widget.field.fieldObjectId === target.widget.field.fieldObjectId
    ) {
      return PdfTaskHelper.resolve(true);
    }

    const affectedEntryMap = new Map<string, FieldGroupEntry>();
    for (const entry of this.getFieldGroup(annotationId, docId)) {
      affectedEntryMap.set(entry.annotationId, entry);
    }
    for (const entry of this.getFieldGroup(targetAnnotationId, docId)) {
      affectedEntryMap.set(entry.annotationId, entry);
    }

    const affectedEntries = [...affectedEntryMap.values()];
    const resultTask = new Task<boolean, PdfErrorReason>();
    const seq = new TaskSequence(resultTask);

    seq.execute(
      async () => {
        await seq.run(() =>
          this.engine.shareWidgetField(doc, source.page, source.widget, target.page, target.widget),
        );

        const syncedEntries = await this.readFieldWidgets(
          doc,
          affectedEntries,
          seq,
          this.shouldRegenerateWidgetAppearances(target.widget.field),
        );
        this.syncFieldBatch(docId, syncedEntries);
        resultTask.resolve(true);
      },
      (err) => ({ code: PdfErrorCode.Unknown, message: String(err) }),
    );

    return resultTask;
  }

  private selectFieldMethod(annotationId: string, documentId?: string): void {
    const docId = documentId ?? this.getActiveDocumentId();
    this.dispatch(selectFieldAction(docId, annotationId));
  }

  private deselectFieldMethod(documentId?: string): void {
    const docId = documentId ?? this.getActiveDocumentId();
    this.dispatch(deselectFieldAction(docId));
  }

  private getSelectedFieldId(documentId?: string): string | null {
    return this.getDocumentState(documentId).selectedFieldId;
  }

  private renderWidget(
    options: RenderWidgetOptions,
    documentId?: string,
  ): Task<Blob, PdfErrorReason> {
    if (!this.annotation) {
      return PdfTaskHelper.reject({
        code: PdfErrorCode.NotFound,
        message: 'annotation plugin not found',
      });
    }

    const id = documentId ?? this.getActiveDocumentId();
    return this.annotation.forDocument(id).renderAnnotation(options);
  }

  async destroy(): Promise<void> {
    this.state$.clear();
    this.fieldValueChange$.clear();
    super.destroy();
  }
}
