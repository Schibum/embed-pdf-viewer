import { h } from 'preact';
import { PdfPermissionFlag } from '@embedpdf/models';
interface PermissionsDisplayProps {
    permissions: number;
    translate: (key: string) => string;
    label?: string;
}
interface PermissionOption {
    flag: PdfPermissionFlag;
    labelKey: string;
}
declare const PERMISSION_OPTIONS: PermissionOption[];
export declare function PermissionsDisplay({ permissions, translate, label }: PermissionsDisplayProps): h.JSX.Element;
export { PERMISSION_OPTIONS };
export type { PermissionOption };
//# sourceMappingURL=permissions-display.d.ts.map