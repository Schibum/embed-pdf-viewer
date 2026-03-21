import { useCallback } from '@framework';
import { PdfWidgetAnnoField, PdfWidgetAnnoObject } from '@embedpdf/models';
import { AnnotationRendererProps } from '@embedpdf/plugin-annotation/@framework';
import { useFormWidgetState } from '../../hooks/use-form-widget-state';
import { useFormDocumentState } from '../../hooks/use-form';
import { RenderWidget } from '../render-widget';

export function ToggleFillMode(props: AnnotationRendererProps<PdfWidgetAnnoObject>) {
  const { annotation, field, scale, pageIndex, scope, handleChangeField, renderKey, isReadOnly } =
    useFormWidgetState(props);
  const formState = useFormDocumentState(props.documentId);

  const isFocused = formState.selectedFieldId === annotation.id;

  const handleClick = useCallback(() => {
    if (isReadOnly) return;
    scope?.selectField(annotation.id);
    if ('isChecked' in field) {
      handleChangeField({ ...field, isChecked: !field.isChecked } as PdfWidgetAnnoField);
    }
  }, [isReadOnly, scope, annotation.id, field, handleChangeField]);

  return (
    <div
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: isReadOnly ? 'default' : 'pointer',
        pointerEvents: 'auto',
        outline: isFocused ? '2px solid rgba(66, 133, 244, 0.8)' : 'none',
        outlineOffset: -2,
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
