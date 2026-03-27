import { BasePlugin, createEmitter, PluginRegistry } from '@embedpdf/core';
import { Task, PdfErrorReason, PdfErrorCode, PdfAnnotationObject } from '@embedpdf/models';
import {
  StampCapability,
  StampScope,
  StampDefinition,
  StampLibrary,
  StampLibraryConfig,
  StampPluginConfig,
  StampState,
  ExportedStampLibrary,
  ResolvedStamp,
} from './types';
import { addStampLibrary, removeStampLibrary, StampAction } from './actions';
import { STAMP_PLUGIN_ID } from './manifest';

const CUSTOM_LIBRARY_ID = 'custom-stamps';
const CUSTOM_LIBRARY_NAME = 'Custom Stamps';

export class StampPlugin extends BasePlugin<
  StampPluginConfig,
  StampCapability,
  StampState,
  StampAction
> {
  static readonly id = STAMP_PLUGIN_ID;

  private readonly libraries = new Map<string, StampLibrary>();
  private readonly libraryChange$ = createEmitter<StampLibrary[]>();
  private nextLibraryId = 0;

  constructor(
    id: string,
    registry: PluginRegistry,
    private config: StampPluginConfig,
  ) {
    super(id, registry);
  }

  async initialize(): Promise<void> {
    if (this.config.libraries) {
      for (const libConfig of this.config.libraries) {
        await this.loadLibraryInternal(libConfig).toPromise();
      }
    }
  }

  protected buildCapability(): StampCapability {
    return {
      getLibraries: () => this.getLibraries(),
      getStampsByCategory: (category) => this.getStampsByCategory(category),
      renderStamp: (libraryId, pageIndex, width, dpr) =>
        this.renderStamp(libraryId, pageIndex, width, dpr),
      loadLibrary: (config) => this.loadLibrary(config),
      createNewLibrary: (name, options) => this.createNewLibrary(name, options),
      addStampToLibrary: (libraryId, stamp, pdf) => this.addStampToLibrary(libraryId, stamp, pdf),
      removeLibrary: (id) => this.removeLibrary(id),
      exportLibrary: (id) => this.exportLibrary(id),
      forDocument: (documentId) => this.createStampScope(documentId),
      onLibraryChange: this.libraryChange$.on,
    };
  }

  getLibraries(): StampLibrary[] {
    return Array.from(this.libraries.values());
  }

  getStampsByCategory(category: string): ResolvedStamp[] {
    const results: ResolvedStamp[] = [];

    for (const library of this.libraries.values()) {
      const libraryMatches = library.categories?.includes(category) ?? false;

      for (const stamp of library.stamps) {
        const stampMatches = stamp.categories?.includes(category) ?? false;
        if (libraryMatches || stampMatches) {
          results.push({ library, stamp });
        }
      }
    }

    return results;
  }

  renderStamp(
    libraryId: string,
    pageIndex: number,
    width: number,
    dpr?: number,
  ): Task<Blob, PdfErrorReason> {
    const library = this.libraries.get(libraryId);
    if (!library) {
      const task = new Task<Blob, PdfErrorReason>();
      task.reject({
        code: PdfErrorCode.NotFound,
        message: `Stamp library not found: ${libraryId}`,
      });
      return task;
    }

    const page = library.document.pages[pageIndex];
    if (!page) {
      const task = new Task<Blob, PdfErrorReason>();
      task.reject({
        code: PdfErrorCode.NotFound,
        message: `Page ${pageIndex} not found in stamp library: ${libraryId}`,
      });
      return task;
    }

    const scaleFactor = width / page.size.width;

    return this.engine.renderPageRect(
      library.document,
      page,
      { origin: { x: 0, y: 0 }, size: page.size },
      {
        scaleFactor,
        dpr: dpr ?? 1,
        withAnnotations: true,
        rotation: page.rotation,
      },
    );
  }

  loadLibrary(config: StampLibraryConfig): Task<string, PdfErrorReason> {
    return this.loadLibraryInternal(config);
  }

  createNewLibrary(
    name: string,
    options?: { categories?: string[] },
  ): Task<string, PdfErrorReason> {
    const task = new Task<string, PdfErrorReason>();
    const libraryId = this.generateLibraryId();
    const documentId = `stamp-doc-${libraryId}`;

    this.engine.createDocument(documentId).wait(
      (doc) => {
        const library: StampLibrary = {
          id: libraryId,
          name,
          document: doc,
          stamps: [],
          categories: options?.categories,
        };

        this.libraries.set(libraryId, library);
        this.dispatch(addStampLibrary(libraryId));
        this.emitLibraryChange();
        task.resolve(libraryId);
      },
      (error) => {
        this.logger.error(
          'StampPlugin',
          'CreateNewLibrary',
          `Failed to create library: ${name}`,
          error,
        );
        task.fail(error);
      },
    );

    return task;
  }

  addStampToLibrary(
    libraryId: string,
    stamp: Omit<StampDefinition, 'pageIndex'>,
    pdf: ArrayBuffer,
  ): Task<void, PdfErrorReason> {
    const task = new Task<void, PdfErrorReason>();

    const library = this.libraries.get(libraryId);
    if (!library) {
      task.reject({
        code: PdfErrorCode.NotFound,
        message: `Stamp library not found: ${libraryId}`,
      });
      return task;
    }

    const tempDocId = `stamp-temp-${Date.now()}`;

    this.engine.openDocumentBuffer({ id: tempDocId, content: pdf }).wait(
      (tempDoc) => {
        this.engine.importPages(library.document, tempDoc, [0]).wait(
          (newPages) => {
            const newPage = newPages[0];
            library.document.pages.push(newPage);
            library.document.pageCount = library.document.pages.length;

            const stampDef: StampDefinition = {
              ...stamp,
              pageIndex: newPage.index,
            };
            library.stamps.push(stampDef);

            this.engine.closeDocument(tempDoc).wait(
              () => {
                this.emitLibraryChange();
                task.resolve();
              },
              () => {
                this.emitLibraryChange();
                task.resolve();
              },
            );
          },
          (error) => {
            this.logger.error('StampPlugin', 'AddStampToLibrary', 'Failed to import page', error);
            this.engine.closeDocument(tempDoc).wait(
              () => task.fail(error),
              () => task.fail(error),
            );
          },
        );
      },
      (error) => {
        this.logger.error(
          'StampPlugin',
          'AddStampToLibrary',
          'Failed to open temp document',
          error,
        );
        task.fail(error);
      },
    );

    return task;
  }

  private createStampScope(documentId: string): StampScope {
    return {
      createStampFromAnnotation: (annotation, stamp, libraryId) =>
        this.createStampFromAnnotation(documentId, annotation, stamp, libraryId),
      createStampFromAnnotations: (annotations, stamp, libraryId) =>
        this.createStampFromAnnotations(documentId, annotations, stamp, libraryId),
    };
  }

  private createStampFromAnnotation(
    documentId: string,
    annotation: PdfAnnotationObject,
    stamp: Omit<StampDefinition, 'pageIndex'>,
    libraryId?: string,
  ): Task<void, PdfErrorReason> {
    const task = new Task<void, PdfErrorReason>();

    const docState = this.getCoreDocument(documentId);
    if (!docState?.document) {
      task.reject({ code: PdfErrorCode.DocNotOpen, message: 'document is not open' });
      return task;
    }

    const doc = docState.document;
    const page = doc.pages[annotation.pageIndex];
    if (!page) {
      task.reject({
        code: PdfErrorCode.NotFound,
        message: `page ${annotation.pageIndex} not found`,
      });
      return task;
    }

    this.resolveTargetLibrary(libraryId).wait(
      (targetId) => {
        this.engine.exportAnnotationAppearanceAsPdf(doc, page, annotation).wait(
          (pdf) => {
            this.addStampToLibrary(targetId, stamp, pdf).wait(
              () => task.resolve(),
              (error) => task.fail(error),
            );
          },
          (error) => {
            this.logger.error(
              'StampPlugin',
              'CreateStampFromAnnotation',
              'Failed to export annotation',
              error,
            );
            task.fail(error);
          },
        );
      },
      (error) => task.fail(error),
    );

    return task;
  }

  private createStampFromAnnotations(
    documentId: string,
    annotations: PdfAnnotationObject[],
    stamp: Omit<StampDefinition, 'pageIndex'>,
    libraryId?: string,
  ): Task<void, PdfErrorReason> {
    const task = new Task<void, PdfErrorReason>();

    if (annotations.length === 0) {
      task.reject({ code: PdfErrorCode.NotFound, message: 'no annotations provided' });
      return task;
    }

    const docState = this.getCoreDocument(documentId);
    if (!docState?.document) {
      task.reject({ code: PdfErrorCode.DocNotOpen, message: 'document is not open' });
      return task;
    }

    const doc = docState.document;
    const page = doc.pages[annotations[0].pageIndex];
    if (!page) {
      task.reject({
        code: PdfErrorCode.NotFound,
        message: `page ${annotations[0].pageIndex} not found`,
      });
      return task;
    }

    this.resolveTargetLibrary(libraryId).wait(
      (targetId) => {
        this.engine.exportAnnotationsAppearanceAsPdf(doc, page, annotations).wait(
          (pdf) => {
            this.addStampToLibrary(targetId, stamp, pdf).wait(
              () => task.resolve(),
              (error) => task.fail(error),
            );
          },
          (error) => {
            this.logger.error(
              'StampPlugin',
              'CreateStampFromAnnotations',
              'Failed to export annotations',
              error,
            );
            task.fail(error);
          },
        );
      },
      (error) => task.fail(error),
    );

    return task;
  }

  private resolveTargetLibrary(libraryId?: string): Task<string, PdfErrorReason> {
    if (libraryId && this.libraries.has(libraryId)) {
      const task = new Task<string, PdfErrorReason>();
      task.resolve(libraryId);
      return task;
    }

    const customLibrary = Array.from(this.libraries.values()).find(
      (lib) => lib.name === CUSTOM_LIBRARY_NAME,
    );
    if (customLibrary) {
      const task = new Task<string, PdfErrorReason>();
      task.resolve(customLibrary.id);
      return task;
    }

    return this.createNewLibrary(CUSTOM_LIBRARY_NAME, { categories: ['custom'] });
  }

  removeLibrary(id: string): Task<void, PdfErrorReason> {
    const task = new Task<void, PdfErrorReason>();

    const library = this.libraries.get(id);
    if (!library) {
      task.resolve();
      return task;
    }

    this.engine.closeDocument(library.document).wait(
      () => {
        this.libraries.delete(id);
        this.dispatch(removeStampLibrary(id));
        this.emitLibraryChange();
        task.resolve();
      },
      () => {
        this.logger.warn(
          'StampPlugin',
          'RemoveLibrary',
          `Failed to close document for library: ${id}`,
        );
        this.libraries.delete(id);
        this.dispatch(removeStampLibrary(id));
        this.emitLibraryChange();
        task.resolve();
      },
    );

    return task;
  }

  exportLibrary(id: string): Task<ExportedStampLibrary, PdfErrorReason> {
    const task = new Task<ExportedStampLibrary, PdfErrorReason>();

    const library = this.libraries.get(id);
    if (!library) {
      task.reject({
        code: PdfErrorCode.NotFound,
        message: `Stamp library not found: ${id}`,
      });
      return task;
    }

    this.engine.saveAsCopy(library.document).wait(
      (pdf) => {
        task.resolve({
          name: library.name,
          pdf,
          stamps: library.stamps,
          categories: library.categories,
        });
      },
      (error) => {
        this.logger.error('StampPlugin', 'ExportLibrary', `Failed to export library: ${id}`, error);
        task.fail(error);
      },
    );

    return task;
  }

  private loadLibraryInternal(config: StampLibraryConfig): Task<string, PdfErrorReason> {
    const task = new Task<string, PdfErrorReason>();
    const libraryId = this.generateLibraryId();
    const documentId = `stamp-doc-${libraryId}`;

    const engineTask =
      typeof config.pdf === 'string'
        ? this.engine.openDocumentUrl({ id: documentId, url: config.pdf })
        : this.engine.openDocumentBuffer({ id: documentId, content: config.pdf });

    engineTask.wait(
      (doc) => {
        const library: StampLibrary = {
          id: libraryId,
          name: config.name,
          document: doc,
          stamps: config.stamps,
          categories: config.categories,
        };

        this.libraries.set(libraryId, library);
        this.dispatch(addStampLibrary(libraryId));
        this.emitLibraryChange();

        task.resolve(libraryId);
      },
      (error) => {
        this.logger.error(
          'StampPlugin',
          'LoadLibrary',
          `Failed to load stamp library: ${config.name}`,
          error,
        );
        task.fail(error);
      },
    );

    return task;
  }

  private generateLibraryId(): string {
    return `stamp-lib-${this.nextLibraryId++}`;
  }

  private emitLibraryChange(): void {
    this.libraryChange$.emit(this.getLibraries());
  }

  override async destroy(): Promise<void> {
    const libs = Array.from(this.libraries.values());
    for (const library of libs) {
      try {
        await this.engine.closeDocument(library.document).toPromise();
      } catch {
        // Best effort cleanup
      }
    }
    this.libraries.clear();
    super.destroy();
  }
}
