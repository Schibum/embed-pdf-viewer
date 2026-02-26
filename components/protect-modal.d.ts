import { h } from 'preact';
interface ProtectModalProps {
    documentId: string;
    isOpen?: boolean;
    onClose?: () => void;
    onExited?: () => void;
}
export declare function ProtectModal({ documentId, isOpen, onClose, onExited }: ProtectModalProps): h.JSX.Element;
export {};
//# sourceMappingURL=protect-modal.d.ts.map