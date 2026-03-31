import { PdfAnnotationSubtype } from '@embedpdf/models';
import type { StampPreviewData } from '@embedpdf/plugin-stamp';
import type { BoxedAnnotationRenderer } from '@embedpdf/plugin-annotation/vue';
import { createRenderer } from '@embedpdf/plugin-annotation/vue';
import StampPreview from './stamp-preview.vue';

export const stampPreviewRenderers: BoxedAnnotationRenderer[] = [
  createRenderer<never, StampPreviewData>({
    id: 'stampPreview',
    matchesPreview: (p) => p.type === PdfAnnotationSubtype.STAMP,
    renderPreview: StampPreview,
  }),
];
