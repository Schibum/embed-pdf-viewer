import { useCallback, useEffect, useState } from '@framework';
import { PdfWidgetAnnoObject } from '@embedpdf/models';
import { AnnotationRendererProps } from '@embedpdf/plugin-annotation/@framework';
import { useFormWidgetState } from '../../hooks/use-form-widget-state';
import { useFormDocumentState } from '../../hooks/use-form';
import { RenderWidget } from '../render-widget';
import { ListboxField } from '../fields/listbox';
import { ListboxFieldProps } from '../types';

export function ListboxFillMode(props: AnnotationRendererProps<PdfWidgetAnnoObject>) {
  const { annotation, scale, pageIndex, scope, handleChangeField, renderKey, isReadOnly } =
    useFormWidgetState(props);
  const formState = useFormDocumentState(props.documentId);
  const [editing, setEditing] = useState(false);

  const isFocused = formState.selectedFieldId === annotation.id;

  useEffect(() => {
    if (isFocused && !editing && !isReadOnly) {
      setEditing(true);
    } else if (!isFocused && editing) {
      setEditing(false);
    }
  }, [isFocused]);

  const handleClick = useCallback(() => {
    if (isReadOnly) return;
    scope?.selectField(annotation.id);
    setEditing(true);
  }, [isReadOnly, scope, annotation.id]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (scope?.getSelectedFieldId() === annotation.id) {
      scope?.deselectField();
    }
  }, [scope, annotation.id]);

  return (
    <div
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: isReadOnly ? 'default' : 'pointer',
        pointerEvents: 'auto',
        outline: isFocused && !editing ? '2px solid rgba(66, 133, 244, 0.8)' : 'none',
        outlineOffset: -2,
      }}
    >
      <ListboxField
        annotation={annotation as ListboxFieldProps['annotation']}
        scale={scale}
        pageIndex={pageIndex}
        isEditable={true}
        onChangeField={handleChangeField}
        onBlur={handleBlur}
      />
      {!editing && (
        <RenderWidget
          pageIndex={pageIndex}
          annotation={annotation}
          scaleFactor={scale}
          renderKey={renderKey}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}
