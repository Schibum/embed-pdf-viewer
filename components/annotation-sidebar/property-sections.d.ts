/** @jsxImportSource preact */
import { h } from 'preact';
import { PropertyConfig } from './property-schema';
export interface PropertySectionProps {
    config: PropertyConfig;
    value: any;
    onChange: (value: any) => void;
    colorPresets: string[];
    translate: (key: string) => string;
}
export declare function PropertySection(props: PropertySectionProps): h.JSX.Element | null;
//# sourceMappingURL=property-sections.d.ts.map