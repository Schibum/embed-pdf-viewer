import { h } from 'preact';
import { useTranslations } from '@embedpdf/plugin-i18n/preact';
import { useStampsByCategory, StampImg } from '@embedpdf/plugin-stamp/preact';
import { Icon } from './ui/icon';

export interface RubberStampSidebarProps {
  documentId: string;
}

const STAMP_THUMB_WIDTH = 120;

export function RubberStampSidebar({ documentId }: RubberStampSidebarProps) {
  const { translate } = useTranslations(documentId);
  const stamps = useStampsByCategory('sidebar');

  return (
    <div class="flex h-full flex-col">
      <div class="border-border-subtle border-b p-3">
        <h2 class="text-fg-primary text-md font-semibold">
          {translate('insert.rubberStamp', { fallback: 'Rubber Stamps' })}
        </h2>
        <p class="text-fg-muted mt-1 text-sm">
          {translate('insert.rubberStamp.placeholder', {
            fallback: 'Stamp presets will appear here.',
          })}
        </p>
      </div>

      {stamps.length > 0 ? (
        <div class="flex-1 overflow-y-auto p-3">
          <div class="grid grid-cols-2 gap-3">
            {stamps.map(({ library, stamp }) => (
              <div
                key={`${library.id}-${stamp.pageIndex}`}
                class="border-border-default hover:border-accent-primary flex cursor-pointer flex-col items-center overflow-hidden rounded-md border transition-colors"
              >
                <div class="flex w-full items-center justify-center p-2">
                  <StampImg
                    libraryId={library.id}
                    pageIndex={stamp.pageIndex}
                    width={STAMP_THUMB_WIDTH}
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                </div>
                <div class="text-fg-secondary w-full truncate border-t px-2 py-1 text-center text-xs">
                  {stamp.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div class="flex flex-1 items-center justify-center p-4">
          <div class="flex max-w-[180px] flex-col items-center gap-3 text-center">
            <Icon icon="rubberStamp" className="text-fg-muted h-12 w-12" />
            <div class="text-fg-secondary text-sm">
              {translate('insert.rubberStamp.emptyState', {
                fallback: 'Choose a stamp from this panel once the insert workflow is connected.',
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
