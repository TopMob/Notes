import type { CloudPullResult } from './types';
import type { PageElementsBundle } from './compression';
export function stable(value: any): string;
export function portableHTML(html: string): string;
export function portableElements(elements: Partial<PageElementsBundle>): PageElementsBundle;
export function assetIds(elements: Partial<PageElementsBundle>): string[];
export function canonicalVersion(entity: string, record: any, elements?: Partial<PageElementsBundle> | null): string;
export function versionHash(entity: string, record: any, elements?: Partial<PageElementsBundle> | null): Promise<string | null>;
export function cloudElementsFor(cloud: CloudPullResult, pageId: string): PageElementsBundle;
