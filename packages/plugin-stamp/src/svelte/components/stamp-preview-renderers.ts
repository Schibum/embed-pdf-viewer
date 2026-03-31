import { PdfAnnotationSubtype } from '@embedpdf/models';
import type { StampPreviewData } from '@embedpdf/plugin-stamp';
import type { BoxedAnnotationRenderer } from '@embedpdf/plugin-annotation/svelte';
import { createRenderer } from '@embedpdf/plugin-annotation/svelte';
import StampPreview from './StampPreview.svelte';

export const stampPreviewRenderers: BoxedAnnotationRenderer[] = [
  createRenderer<never, StampPreviewData>({
    id: 'stampPreview',
    matchesPreview: (p) => p.type === PdfAnnotationSubtype.STAMP,
    renderPreview: StampPreview,
  }),
];
