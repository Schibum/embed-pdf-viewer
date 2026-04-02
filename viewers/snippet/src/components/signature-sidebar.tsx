import { h } from 'preact';
import { useCallback } from 'preact/hooks';
import { useTranslations } from '@embedpdf/plugin-i18n/preact';
import {
  useSignatureEntries,
  useActivePlacement,
  SignatureEntry,
  SignatureFieldKind,
  SignatureMode,
} from '@embedpdf/plugin-signature/preact';
import { useCapability } from '@embedpdf/core/preact';
import { UIPlugin } from '@embedpdf/plugin-ui';
import { Icon } from './ui/icon';

export interface SignatureSidebarProps {
  documentId: string;
}

export function SignatureSidebar({ documentId }: SignatureSidebarProps) {
  const { translate } = useTranslations(documentId);
  const { entries, provides: capability } = useSignatureEntries();
  const activePlacement = useActivePlacement(documentId);
  const { provides: uiCapability } = useCapability<UIPlugin>('ui');

  const mode = capability?.mode ?? SignatureMode.SignatureOnly;
  const showInitials = mode === SignatureMode.SignatureAndInitials;

  const handleCreate = useCallback(() => {
    if (!uiCapability) return;
    uiCapability.forDocument(documentId).openModal('signature-create-modal');
  }, [uiCapability, documentId]);

  const handlePlaceSignature = useCallback(
    (entryId: string) => {
      if (!capability) return;
      capability.forDocument(documentId).activateSignaturePlacement(entryId);
    },
    [capability, documentId],
  );

  const handlePlaceInitials = useCallback(
    (entryId: string) => {
      if (!capability) return;
      capability.forDocument(documentId).activateInitialsPlacement(entryId);
    },
    [capability, documentId],
  );

  const handleRemove = useCallback(
    (e: Event, entryId: string) => {
      e.stopPropagation();
      if (!capability) return;
      capability.removeEntry(entryId);
    },
    [capability],
  );

  const isActive = (entryId: string, kind: SignatureFieldKind) =>
    activePlacement?.entryId === entryId && activePlacement?.kind === kind;

  return (
    <div class="flex h-full flex-col">
      <div class="border-border-subtle border-b p-3">
        <h2 class="text-fg-primary text-md font-semibold">
          {translate('signature.title', { fallback: 'Signatures' })}
        </h2>
        <button
          class="bg-accent hover:bg-accent-hover text-fg-on-accent mt-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors"
          onClick={handleCreate}
        >
          {translate('signature.createNew', {
            fallback: showInitials ? 'Create Signature & Initials' : 'Create New Signature',
          })}
        </button>
      </div>

      {entries.length > 0 ? (
        <div class="flex-1 overflow-y-auto p-3">
          <div class="flex flex-col gap-3">
            {entries.map((entry: SignatureEntry) => (
              <div
                key={entry.id}
                class="border-border-subtle bg-bg-surface group relative rounded-md border p-3"
              >
                <button
                  class="bg-bg-surface border-border-default text-fg-muted hover:text-fg-primary absolute right-1 top-1 flex rounded-full border p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                  onClick={(e: Event) => handleRemove(e, entry.id)}
                >
                  <Icon icon="x" className="h-3 w-3" />
                </button>

                {/* Signature field */}
                <div
                  class={`flex cursor-pointer items-center gap-2 rounded p-2 transition-colors ${
                    isActive(entry.id, SignatureFieldKind.Signature)
                      ? 'bg-accent-light ring-accent ring-2'
                      : 'hover:bg-interactive-hover'
                  }`}
                  onClick={() => handlePlaceSignature(entry.id)}
                >
                  <img
                    src={entry.signature.previewDataUrl}
                    class="h-10 max-w-full object-contain"
                    alt="Signature"
                  />
                  <span class="text-fg-muted text-xs">
                    {translate('signature.placeSignature', { fallback: 'Signature' })}
                  </span>
                </div>

                {/* Initials field */}
                {showInitials && entry.initials && (
                  <div
                    class={`mt-2 flex cursor-pointer items-center gap-2 rounded p-2 transition-colors ${
                      isActive(entry.id, SignatureFieldKind.Initials)
                        ? 'bg-accent-light ring-accent ring-2'
                        : 'hover:bg-interactive-hover'
                    }`}
                    onClick={() => handlePlaceInitials(entry.id)}
                  >
                    <img
                      src={entry.initials.previewDataUrl}
                      class="h-8 max-w-full object-contain"
                      alt="Initials"
                    />
                    <span class="text-fg-muted text-xs">
                      {translate('signature.placeInitials', { fallback: 'Initials' })}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div class="flex flex-1 items-center justify-center p-4">
          <div class="flex max-w-[180px] flex-col items-center gap-3 text-center">
            <Icon icon="signature" className="text-fg-muted h-12 w-12" />
            <div class="text-fg-secondary text-sm">
              {translate('signature.emptyState', {
                fallback: 'No signatures yet. Create one to get started.',
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
