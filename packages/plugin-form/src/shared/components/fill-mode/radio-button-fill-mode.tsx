import { useCallback } from '@framework';
import { PdfWidgetAnnoField, PdfWidgetAnnoObject } from '@embedpdf/models';
import { AnnotationRendererProps } from '@embedpdf/plugin-annotation/@framework';
import { useFormWidgetState } from '../../hooks/use-form-widget-state';
import { RenderWidget } from '../render-widget';

export function RadioButtonFillMode(props: AnnotationRendererProps<PdfWidgetAnnoObject>) {
  const { annotation, field, scale, pageIndex, handleChangeField, renderKey, isReadOnly } =
    useFormWidgetState(props);

  const handleClick = useCallback(() => {
    if (isReadOnly) return;
    if ('isChecked' in field) {
      handleChangeField({ ...field, isChecked: true } as PdfWidgetAnnoField);
    }
  }, [isReadOnly, field, handleChangeField]);

  return (
    <div
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: isReadOnly ? 'default' : 'pointer',
        pointerEvents: 'auto',
      }}
    >
      <RenderWidget
        pageIndex={pageIndex}
        annotation={annotation}
        scaleFactor={scale}
        renderKey={renderKey}
        style={{ pointerEvents: 'none' }}
      />
    </div>
  );
}
