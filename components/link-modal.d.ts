import { h } from 'preact';
type LinkSource = 'annotation' | 'selection';
interface LinkModalProps {
    documentId: string;
    isOpen?: boolean;
    onClose?: () => void;
    onExited?: () => void;
    /** Source context that triggered the modal */
    source?: LinkSource;
}
export declare function LinkModal({ documentId, isOpen, onClose, onExited, source }: LinkModalProps): h.JSX.Element;
export {};
//# sourceMappingURL=link-modal.d.ts.map