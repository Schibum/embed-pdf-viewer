import { useCallback, useEffect, useState } from '@framework';
import { PdfWidgetAnnoObject } from '@embedpdf/models';
import { AnnotationRendererProps } from '@embedpdf/plugin-annotation/@framework';
import { useFormWidgetState } from '../../hooks/use-form-widget-state';
import { useFormDocumentState } from '../../hooks/use-form';
import { RenderWidget } from '../render-widget';
import { TextField } from '../fields/text';
import { TextFieldProps } from '../types';

export function TextFillMode(props: AnnotationRendererProps<PdfWidgetAnnoObject>) {
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

  const focusRef = useCallback((el: HTMLElement | null) => {
    if (el) el.focus();
  }, []);

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
      {!editing && (
        <RenderWidget
          pageIndex={pageIndex}
          annotation={annotation}
          scaleFactor={scale}
          renderKey={renderKey}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {editing && (
        <TextField
          annotation={annotation as TextFieldProps['annotation']}
          scale={scale}
          pageIndex={pageIndex}
          isEditable={true}
          onChangeField={handleChangeField}
          onBlur={handleBlur}
          inputRef={focusRef}
        />
      )}
    </div>
  );
}
