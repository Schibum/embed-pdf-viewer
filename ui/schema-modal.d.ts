import { h } from 'preact';
import { ModalSchema } from '@embedpdf/plugin-ui';
export interface ModalRendererProps {
    schema: ModalSchema;
    documentId: string;
    isOpen: boolean;
    onClose: () => void;
    onExited: () => void;
    modalProps?: Record<string, unknown>;
}
/**
 * Schema-driven Modal Renderer for Preact
 *
 * Renders modals defined in the UI schema.
 * Supports animation lifecycle via isOpen and onExited props.
 */
export declare function SchemaModal({ schema, documentId, isOpen, onClose, onExited, modalProps, }: ModalRendererProps): h.JSX.Element | null;
//# sourceMappingURL=schema-modal.d.ts.map