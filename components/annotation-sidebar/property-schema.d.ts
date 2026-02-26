import { PdfAnnotationSubtype } from '@embedpdf/models';
/**
 * Configuration for a single editable property in the sidebar.
 */
export interface PropertyConfig {
    /** The property key on the annotation object */
    key: string;
    /** The type of UI control to render */
    type: 'color' | 'colorWithTransparent' | 'opacity' | 'slider' | 'strokeStyle' | 'lineEndings' | 'fontFamily' | 'fontSize' | 'fontColor' | 'textAlign' | 'verticalAlign' | 'blendMode' | 'text' | 'rotation';
    /** Translation key for the label */
    labelKey: string;
    /** Translation key for the placeholder (optional, for text inputs) */
    placeholderKey?: string;
    /** Minimum value for sliders */
    min?: number;
    /** Maximum value for sliders */
    max?: number;
    /** Step value for sliders */
    step?: number;
    /** Unit to display (e.g., 'px', '%') */
    unit?: string;
    /** Whether to debounce changes (for sliders) */
    debounce?: boolean;
    /** If true, only show this property when editing an existing annotation (not for tool defaults) */
    editOnly?: boolean;
}
/**
 * All available property configurations.
 * Each property has a unique identifier and its UI configuration.
 */
export declare const PROPERTY_CONFIGS: Record<string, PropertyConfig>;
/**
 * Maps annotation types to their ordered list of editable properties.
 * The order determines the display order in the sidebar.
 */
export declare const ANNOTATION_PROPERTIES: Partial<Record<PdfAnnotationSubtype, string[]>>;
/**
 * Computes the intersection of editable properties for the given annotation types.
 * Returns properties in the order they appear in the first type's property list.
 *
 * @param types - Array of annotation subtypes to compute intersection for
 * @returns Array of property keys that are shared by ALL given types
 */
export declare function getSharedProperties(types: PdfAnnotationSubtype[]): string[];
//# sourceMappingURL=property-schema.d.ts.map