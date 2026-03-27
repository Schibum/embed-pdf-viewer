import { BasePluginConfig, EventHook } from '@embedpdf/core';
import { PdfAnnotationObject, PdfDocumentObject, PdfTask } from '@embedpdf/models';

export interface StampDefinition {
  pageIndex: number;
  name: string;
  subject: string;
  label?: string;
  categories?: string[];
}

export interface StampLibraryConfig {
  name: string;
  pdf: string | ArrayBuffer;
  stamps: StampDefinition[];
  categories?: string[];
}

export interface StampLibrary {
  id: string;
  name: string;
  document: PdfDocumentObject;
  stamps: StampDefinition[];
  categories?: string[];
}

export interface ResolvedStamp {
  library: StampLibrary;
  stamp: StampDefinition;
}

export interface ExportedStampLibrary {
  name: string;
  pdf: ArrayBuffer;
  stamps: StampDefinition[];
  categories?: string[];
}

export interface StampPluginConfig extends BasePluginConfig {
  libraries?: StampLibraryConfig[];
}

export interface StampState {
  libraryIds: string[];
}

export interface StampScope {
  createStampFromAnnotation(
    annotation: PdfAnnotationObject,
    stamp: Omit<StampDefinition, 'pageIndex'>,
    libraryId?: string,
  ): PdfTask<void>;

  createStampFromAnnotations(
    annotations: PdfAnnotationObject[],
    stamp: Omit<StampDefinition, 'pageIndex'>,
    libraryId?: string,
  ): PdfTask<void>;
}

export interface StampCapability {
  getLibraries(): StampLibrary[];
  getStampsByCategory(category: string): ResolvedStamp[];
  renderStamp(libraryId: string, pageIndex: number, width: number, dpr?: number): PdfTask<Blob>;
  loadLibrary(config: StampLibraryConfig): PdfTask<string>;
  createNewLibrary(name: string, options?: { categories?: string[] }): PdfTask<string>;
  addStampToLibrary(
    libraryId: string,
    stamp: Omit<StampDefinition, 'pageIndex'>,
    pdf: ArrayBuffer,
  ): PdfTask<void>;
  removeLibrary(id: string): PdfTask<void>;
  exportLibrary(id: string): PdfTask<ExportedStampLibrary>;
  forDocument(documentId: string): StampScope;
  onLibraryChange: EventHook<StampLibrary[]>;
}
