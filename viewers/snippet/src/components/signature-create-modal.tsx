import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { useTranslations } from '@embedpdf/plugin-i18n/preact';
import {
  useSignatureCapability,
  SignatureDrawPad,
  SignatureTypePad,
  SignatureUploadPad,
  SignatureFieldDefinition,
  SignatureMode,
  SignatureBinaryData,
} from '@embedpdf/plugin-signature/preact';
import { Dialog } from './ui/dialog';

interface SignatureCreateModalProps {
  documentId: string;
  isOpen?: boolean;
  onClose?: () => void;
  onExited?: () => void;
}

type CreationTab = 'draw' | 'type' | 'upload';

interface StepResult {
  field: SignatureFieldDefinition;
  imageData?: ArrayBuffer;
}

export function SignatureCreateModal({
  documentId,
  isOpen,
  onClose,
  onExited,
}: SignatureCreateModalProps) {
  const { translate } = useTranslations(documentId);
  const { provides: signatureCapability } = useSignatureCapability();

  const mode = signatureCapability?.mode ?? SignatureMode.SignatureOnly;
  const needsInitials = mode === SignatureMode.SignatureAndInitials;

  const [activeTab, setActiveTab] = useState<CreationTab>('draw');
  const [step, setStep] = useState<1 | 2>(1);
  const [signatureResult, setSignatureResult] = useState<StepResult | null>(null);
  const [currentResult, setCurrentResult] = useState<StepResult | null>(null);

  const resetState = useCallback(() => {
    setActiveTab('draw');
    setStep(1);
    setSignatureResult(null);
    setCurrentResult(null);
  }, []);

  const handleResult = useCallback(
    (result: (SignatureFieldDefinition & { imageData?: ArrayBuffer }) | null) => {
      if (!result) {
        setCurrentResult(null);
        return;
      }
      const { imageData, ...field } = result;
      setCurrentResult({ field, imageData });
    },
    [],
  );

  const handleNext = useCallback(() => {
    if (!currentResult) return;

    if (step === 1 && needsInitials) {
      setSignatureResult(currentResult);
      setCurrentResult(null);
      setActiveTab('draw');
      setStep(2);
    } else {
      if (!signatureCapability) return;

      const sigResult = step === 1 ? currentResult : signatureResult;
      const iniResult = step === 2 ? currentResult : undefined;

      if (!sigResult) return;

      const binaryData: SignatureBinaryData = {};
      if (sigResult.imageData) binaryData.signatureImageData = sigResult.imageData;
      if (iniResult?.imageData) binaryData.initialsImageData = iniResult.imageData;

      signatureCapability.addEntry(
        {
          signature: sigResult.field,
          ...(iniResult && { initials: iniResult.field }),
        },
        binaryData,
      );

      resetState();
      onClose?.();
    }
  }, [
    currentResult,
    signatureResult,
    step,
    needsInitials,
    signatureCapability,
    onClose,
    resetState,
  ]);

  const handleClose = useCallback(() => {
    resetState();
    onClose?.();
  }, [resetState, onClose]);

  const stepLabel =
    step === 1
      ? translate('signature.create.signatureStep', { fallback: 'Create your signature' })
      : translate('signature.create.initialsStep', { fallback: 'Create your initials' });

  const tabs: Array<{ id: CreationTab; label: string }> = [
    { id: 'draw', label: translate('signature.create.draw', { fallback: 'Draw' }) },
    { id: 'type', label: translate('signature.create.type', { fallback: 'Type' }) },
    { id: 'upload', label: translate('signature.create.upload', { fallback: 'Upload' }) },
  ];

  const isLastStep = !needsInitials || step === 2;
  const buttonLabel = isLastStep
    ? translate('signature.create.save', { fallback: 'Save' })
    : translate('signature.create.next', { fallback: 'Next' });

  return (
    <Dialog open={!!isOpen} title={stepLabel} onClose={handleClose} onExited={onExited}>
      <div class="flex flex-col gap-4">
        {needsInitials && (
          <div class="text-fg-muted text-xs">
            {translate('signature.create.stepIndicator', {
              fallback: `Step ${step} of 2`,
            })}
          </div>
        )}

        {/* Tab selector */}
        <div class="border-border-subtle flex gap-1 border-b">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              class={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-accent text-accent border-b-2'
                  : 'text-fg-muted hover:text-fg-primary'
              }`}
              onClick={() => {
                setActiveTab(tab.id);
                setCurrentResult(null);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div class="flex justify-center">
          {activeTab === 'draw' && (
            <SignatureDrawPad onResult={handleResult} width={380} height={160} />
          )}
          {activeTab === 'type' && (
            <SignatureTypePad onResult={handleResult} width={380} height={160} />
          )}
          {activeTab === 'upload' && (
            <SignatureUploadPad onResult={handleResult} width={380} height={160} />
          )}
        </div>

        {/* Actions */}
        <div class="flex justify-end gap-2">
          {step === 2 && (
            <button
              class="text-fg-muted hover:text-fg-primary rounded-md px-3 py-1.5 text-sm transition-colors"
              onClick={() => {
                setStep(1);
                setCurrentResult(signatureResult);
                setSignatureResult(null);
                setActiveTab('draw');
              }}
            >
              {translate('signature.create.back', { fallback: 'Back' })}
            </button>
          )}
          <button
            class="text-fg-muted hover:text-fg-primary rounded-md px-3 py-1.5 text-sm transition-colors"
            onClick={handleClose}
          >
            {translate('signature.create.cancel', { fallback: 'Cancel' })}
          </button>
          <button
            class="bg-accent hover:bg-accent-hover text-fg-on-accent rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!currentResult}
            onClick={handleNext}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
