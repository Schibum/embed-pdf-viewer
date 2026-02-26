import { h } from 'preact';
import { AnnotationTool, TrackedAnnotation } from '@embedpdf/plugin-annotation';
interface DynamicSidebarProps {
    documentId: string;
    /** Selected annotations - length 0 = tool defaults, 1 = single, 2+ = multi */
    annotations: TrackedAnnotation[];
    /** The currently active tool (used when no annotations selected) */
    activeTool: AnnotationTool | null;
    /** Color presets for color pickers */
    colorPresets: string[];
}
export declare function DynamicSidebar({ documentId, annotations, activeTool, colorPresets, }: DynamicSidebarProps): h.JSX.Element | null;
export {};
//# sourceMappingURL=dynamic-sidebar.d.ts.map