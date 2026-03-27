import { h } from 'preact';
import { useTranslations } from '@embedpdf/plugin-i18n/preact';
import { Icon } from './ui/icon';

export interface SignatureSidebarProps {
  documentId: string;
}

export function SignatureSidebar({ documentId }: SignatureSidebarProps) {
  const { translate } = useTranslations(documentId);

  return (
    <div class="flex h-full flex-col">
      <div class="border-border-subtle border-b p-3">
        <h2 class="text-fg-primary text-md font-semibold">
          {translate('insert.signature', { fallback: 'Signatures' })}
        </h2>
        <p class="text-fg-muted mt-1 text-sm">
          {translate('insert.signature.placeholder', {
            fallback: 'Signature options will appear here.',
          })}
        </p>
      </div>

      <div class="flex flex-1 items-center justify-center p-4">
        <div class="flex max-w-[180px] flex-col items-center gap-3 text-center">
          <Icon icon="signature" className="text-fg-muted h-12 w-12" />
          <div class="text-fg-secondary text-sm">
            {translate('insert.signature.emptyState', {
              fallback:
                'Choose a signature option from this panel once the insert workflow is connected.',
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
