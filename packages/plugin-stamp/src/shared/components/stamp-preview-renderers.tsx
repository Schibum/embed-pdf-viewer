import { PdfAnnotationSubtype } from '@embedpdf/models';
import { createRenderer, BoxedAnnotationRenderer } from '@embedpdf/plugin-annotation/@framework';
import { StampPreviewData } from '@embedpdf/plugin-stamp';

export const stampPreviewRenderers: BoxedAnnotationRenderer[] = [
  createRenderer<never, StampPreviewData>({
    id: 'stampPreview',
    matchesPreview: (p) => p.type === PdfAnnotationSubtype.STAMP,
    renderPreview: ({ data }) => {
      const rotationDeg = ((4 - data.pageRotation) % 4) * 90;
      return (
        <img
          src={data.ghostUrl}
          style={{
            width: '100%',
            height: '100%',
            opacity: 0.6,
            objectFit: 'contain' as const,
            pointerEvents: 'none' as const,
            transform: rotationDeg ? `rotate(${rotationDeg}deg)` : undefined,
          }}
          alt=""
        />
      );
    },
  }),
];
