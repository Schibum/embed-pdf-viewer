import { h } from 'preact';
export interface CaptureData {
    pageIndex: number;
    rect: any;
    blob: Blob;
}
export interface CaptureProps {
    documentId: string;
}
export declare function Capture({ documentId }: CaptureProps): h.JSX.Element;
//# sourceMappingURL=capture.d.ts.map