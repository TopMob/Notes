import { decompressBatch, decompressJson } from './compression';
import type { CloudPullResult } from './types';

// A full page bundle supersedes legacy rows for that page, including erased objects.
export async function decodeCloudElements(rows: Record<string, any>[]): Promise<CloudPullResult['elements']> {
  const bundles = new Map<string, Record<string, any>>();
  for (const row of rows) if (row.type === 'bundle') {
    const previous = bundles.get(String(row.page_id));
    if (!previous || Number(row.updated_at) > Number(previous.updated_at)) bundles.set(String(row.page_id), row);
  }
  const elements: CloudPullResult['elements'] = [];
  for (const row of rows) {
    const pageId = String(row.page_id);
    if (row.type === 'bundle' ? bundles.get(pageId) !== row : bundles.has(pageId)) continue;
    const updatedAt = Number(row.updated_at);
    const deletedAt = row.deleted_at ? Number(row.deleted_at) : null;
    if (row.type === 'bundle') {
      // A deleted bundle is not permission to delete arbitrary local objects.
      if (deletedAt) continue;
      const bundle = await decompressBatch(row.data);
      for (const [key, type] of [['strokes', 'stroke'], ['shapes', 'shape'], ['textBlocks', 'textBlock']] as const) {
        for (const data of bundle[key]) elements.push({ id: data.id, pageId, type, data, updatedAt, deletedAt });
      }
    } else {
      if (!['stroke', 'shape', 'textBlock'].includes(row.type)) throw new Error('Неизвестный тип облачного элемента');
      elements.push({ id: String(row.id), pageId, type: row.type, data: deletedAt ? null : await decompressJson(row.data), updatedAt, deletedAt });
    }
  }
  return elements;
}
