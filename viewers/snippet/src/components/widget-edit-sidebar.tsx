/** @jsxImportSource preact */
import { h } from 'preact';
import { useCallback } from 'preact/hooks';
import {
  PdfAnnotationSubtype,
  PdfWidgetAnnoObject,
  PdfWidgetAnnoField,
  PdfWidgetAnnoOption,
  PDF_FORM_FIELD_TYPE,
  PDF_FORM_FIELD_FLAG,
} from '@embedpdf/models';
import { useAnnotation } from '@embedpdf/plugin-annotation/preact';
import { getSelectedAnnotations } from '@embedpdf/plugin-annotation';
import { useTranslations } from '@embedpdf/plugin-i18n/preact';

import { Checkbox } from './ui/checkbox';

export interface WidgetEditSidebarProps {
  documentId: string;
}

const FIELD_TYPE_LABEL_KEYS: Partial<Record<PDF_FORM_FIELD_TYPE, string>> = {
  [PDF_FORM_FIELD_TYPE.TEXTFIELD]: 'form.textfield',
  [PDF_FORM_FIELD_TYPE.CHECKBOX]: 'form.checkbox',
  [PDF_FORM_FIELD_TYPE.RADIOBUTTON]: 'form.radiobutton',
  [PDF_FORM_FIELD_TYPE.COMBOBOX]: 'form.combobox',
  [PDF_FORM_FIELD_TYPE.LISTBOX]: 'form.listbox',
};

const FIELD_TYPE_FALLBACKS: Partial<Record<PDF_FORM_FIELD_TYPE, string>> = {
  [PDF_FORM_FIELD_TYPE.TEXTFIELD]: 'Text Field',
  [PDF_FORM_FIELD_TYPE.CHECKBOX]: 'Checkbox',
  [PDF_FORM_FIELD_TYPE.RADIOBUTTON]: 'Radio Button',
  [PDF_FORM_FIELD_TYPE.COMBOBOX]: 'Dropdown',
  [PDF_FORM_FIELD_TYPE.LISTBOX]: 'List Box',
};

const INPUT_CLASS =
  'border-border-default bg-bg-input text-fg-primary w-full rounded border px-2 py-1.5 text-sm';

export const WidgetEditSidebar = ({ documentId }: WidgetEditSidebarProps) => {
  const { provides: annotation, state } = useAnnotation(documentId);
  const { translate } = useTranslations(documentId);
  if (!annotation) return null;

  const selected = getSelectedAnnotations(state);
  if (selected.length !== 1) return null;

  const annot = selected[0].object;
  if (annot.type !== PdfAnnotationSubtype.WIDGET) return null;

  const widget = annot as PdfWidgetAnnoObject;
  const labelKey = FIELD_TYPE_LABEL_KEYS[widget.field.type] ?? '';
  const fallback = FIELD_TYPE_FALLBACKS[widget.field.type] ?? 'Widget';
  const fieldLabel = translate(labelKey, { fallback });
  const title = translate('annotation.styles', { params: { type: fieldLabel } });

  const applyPatch = useCallback(
    (patch: Partial<PdfWidgetAnnoObject>) => {
      annotation.updateAnnotations([{ pageIndex: widget.pageIndex, id: widget.id, patch }]);
    },
    [annotation, widget.pageIndex, widget.id],
  );

  const updateField = useCallback(
    (fieldPatch: Partial<PdfWidgetAnnoField>) => {
      applyPatch({ field: { ...widget.field, ...fieldPatch } as PdfWidgetAnnoField });
    },
    [applyPatch, widget.field],
  );

  return (
    <div class="h-full overflow-y-auto p-4">
      <h2 class="text-fg-secondary text-md mb-4 font-medium">{title}</h2>

      {widget.field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD && (
        <TextFieldSection field={widget.field} updateField={updateField} translate={translate} />
      )}
      {widget.field.type === PDF_FORM_FIELD_TYPE.CHECKBOX && (
        <CheckboxFieldSection
          field={widget.field}
          updateField={updateField}
          translate={translate}
        />
      )}
      {(widget.field.type === PDF_FORM_FIELD_TYPE.COMBOBOX ||
        widget.field.type === PDF_FORM_FIELD_TYPE.LISTBOX) && (
        <ChoiceFieldSection field={widget.field} updateField={updateField} translate={translate} />
      )}
    </div>
  );
};

interface FieldSectionProps {
  field: PdfWidgetAnnoField;
  updateField: (patch: Partial<PdfWidgetAnnoField>) => void;
  translate: (key: string, opts?: { fallback?: string; params?: Record<string, string> }) => string;
}

function useToggleFlag(
  field: PdfWidgetAnnoField,
  updateField: (patch: Partial<PdfWidgetAnnoField>) => void,
) {
  return useCallback(
    (flag: PDF_FORM_FIELD_FLAG, enabled: boolean) => {
      const current = field.flag ?? PDF_FORM_FIELD_FLAG.NONE;
      updateField({ flag: enabled ? current | flag : current & ~flag });
    },
    [field.flag, updateField],
  );
}

function TextFieldSection({ field, updateField, translate }: FieldSectionProps) {
  const toggleFlag = useToggleFlag(field, updateField);

  return (
    <div class="space-y-4">
      <div>
        <label class="text-fg-secondary mb-1 block text-xs font-medium">
          {translate('form.fieldName', { fallback: 'Field Name' })}*:
        </label>
        <input
          type="text"
          class={INPUT_CLASS}
          value={field.name}
          onBlur={(e) => updateField({ name: (e.target as HTMLInputElement).value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>

      <div>
        <label class="text-fg-secondary mb-1 block text-xs font-medium">
          {translate('form.defaultValue', { fallback: 'Default Value' })}:
        </label>
        <input
          type="text"
          class={INPUT_CLASS}
          value={field.value ?? ''}
          onBlur={(e) => updateField({ value: (e.target as HTMLInputElement).value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>

      <hr class="border-border-default" />

      <div>
        <h3 class="text-fg-primary mb-3 text-sm font-medium">
          {translate('form.properties', { fallback: 'Properties' })}
        </h3>
        <div class="flex flex-col gap-3">
          <Checkbox
            label={translate('form.readOnly', { fallback: 'Read Only' })}
            checked={!!(field.flag & PDF_FORM_FIELD_FLAG.READONLY)}
            onChange={(v) => toggleFlag(PDF_FORM_FIELD_FLAG.READONLY, v)}
          />
          <Checkbox
            label={translate('form.required', { fallback: 'Required' })}
            checked={!!(field.flag & PDF_FORM_FIELD_FLAG.REQUIRED)}
            onChange={(v) => toggleFlag(PDF_FORM_FIELD_FLAG.REQUIRED, v)}
          />
          <Checkbox
            label={translate('form.multiline', { fallback: 'Multiline' })}
            checked={!!(field.flag & PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE)}
            onChange={(v) => toggleFlag(PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE, v)}
          />
        </div>
      </div>
    </div>
  );
}

function CheckboxFieldSection({ field, updateField, translate }: FieldSectionProps) {
  const toggleFlag = useToggleFlag(field, updateField);

  return (
    <div class="space-y-4">
      <div>
        <label class="text-fg-secondary mb-1 block text-xs font-medium">
          {translate('form.fieldName', { fallback: 'Field Name' })}*:
        </label>
        <input
          type="text"
          class={INPUT_CLASS}
          value={field.name}
          onBlur={(e) => updateField({ name: (e.target as HTMLInputElement).value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>

      <hr class="border-border-default" />

      <div>
        <h3 class="text-fg-primary mb-3 text-sm font-medium">
          {translate('form.properties', { fallback: 'Properties' })}
        </h3>
        <div class="flex flex-col gap-3">
          <Checkbox
            label={translate('form.readOnly', { fallback: 'Read Only' })}
            checked={!!(field.flag & PDF_FORM_FIELD_FLAG.READONLY)}
            onChange={(v) => toggleFlag(PDF_FORM_FIELD_FLAG.READONLY, v)}
          />
          <Checkbox
            label={translate('form.required', { fallback: 'Required' })}
            checked={!!(field.flag & PDF_FORM_FIELD_FLAG.REQUIRED)}
            onChange={(v) => toggleFlag(PDF_FORM_FIELD_FLAG.REQUIRED, v)}
          />
        </div>
      </div>
    </div>
  );
}

function ChoiceFieldSection({ field, updateField, translate }: FieldSectionProps) {
  const toggleFlag = useToggleFlag(field, updateField);
  const options: PdfWidgetAnnoOption[] =
    field.type === PDF_FORM_FIELD_TYPE.COMBOBOX || field.type === PDF_FORM_FIELD_TYPE.LISTBOX
      ? (field as { options: PdfWidgetAnnoOption[] }).options
      : [];

  const setOptions = useCallback(
    (newOptions: PdfWidgetAnnoOption[]) => {
      updateField({ options: newOptions } as Partial<PdfWidgetAnnoField>);
    },
    [updateField],
  );

  return (
    <div class="space-y-4">
      <div>
        <label class="text-fg-secondary mb-1 block text-xs font-medium">
          {translate('form.fieldName', { fallback: 'Field Name' })}*:
        </label>
        <input
          type="text"
          class={INPUT_CLASS}
          value={field.name}
          onBlur={(e) => updateField({ name: (e.target as HTMLInputElement).value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>

      <hr class="border-border-default" />

      <div>
        <h3 class="text-fg-primary mb-3 text-sm font-medium">
          {translate('form.options', { fallback: 'Options' })}
        </h3>
        <div class="flex flex-col gap-2">
          {options.map((opt, i) => (
            <div key={i} class="flex items-center gap-2">
              <input
                type="text"
                class={INPUT_CLASS + ' flex-1'}
                value={opt.label}
                onBlur={(e) => {
                  const newLabel = (e.target as HTMLInputElement).value;
                  if (newLabel === opt.label) return;
                  const updated = options.map((o, j) => (j === i ? { ...o, label: newLabel } : o));
                  setOptions(updated);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <button
                type="button"
                class="text-fg-secondary hover:text-fg-primary shrink-0 text-sm"
                onClick={() => {
                  const updated = options.filter((_, j) => j !== i);
                  setOptions(updated);
                }}
                title={translate('form.removeOption', { fallback: 'Remove' })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            class="text-accent-primary hover:text-accent-primary-hover mt-1 text-left text-sm"
            onClick={() => {
              setOptions([
                ...options,
                { label: `Option ${options.length + 1}`, isSelected: false },
              ]);
            }}
          >
            + {translate('form.addOption', { fallback: 'Add Option' })}
          </button>
        </div>
      </div>

      <hr class="border-border-default" />

      <div>
        <h3 class="text-fg-primary mb-3 text-sm font-medium">
          {translate('form.properties', { fallback: 'Properties' })}
        </h3>
        <div class="flex flex-col gap-3">
          <Checkbox
            label={translate('form.readOnly', { fallback: 'Read Only' })}
            checked={!!(field.flag & PDF_FORM_FIELD_FLAG.READONLY)}
            onChange={(v) => toggleFlag(PDF_FORM_FIELD_FLAG.READONLY, v)}
          />
          <Checkbox
            label={translate('form.required', { fallback: 'Required' })}
            checked={!!(field.flag & PDF_FORM_FIELD_FLAG.REQUIRED)}
            onChange={(v) => toggleFlag(PDF_FORM_FIELD_FLAG.REQUIRED, v)}
          />
        </div>
      </div>
    </div>
  );
}
