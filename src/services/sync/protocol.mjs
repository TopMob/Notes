export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export function portableHTML(html) {
  return String(html || '').replace(/<img\b[^>]*>/gi, tag => /\bdata-asset-id\s*=/i.test(tag) ? tag.replace(/\s+src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '') : tag);
}
export function portableElements(elements) {
  return { strokes: elements?.strokes || [], shapes: elements?.shapes || [], textBlocks: (elements?.textBlocks || []).map(row => ({ ...row, contentHTML: portableHTML(row.contentHTML) })) };
}
export function assetIds(elements) {
  const ids = new Set();
  for (const row of elements?.textBlocks || []) for (const match of String(row.contentHTML || '').matchAll(/\bdata-asset-id\s*=\s*["']([^"']+)["']/gi)) ids.add(match[1]);
  return [...ids];
}
export function canonicalVersion(entity, record, elements) {
  if (!record) {
    const portable = portableElements(elements);
    if (entity === 'pages' && Object.values(portable).some(rows => rows.length)) return stable({ orphan: true, elements: Object.fromEntries(Object.entries(portable).map(([key, rows]) => [key, [...rows].sort((a,b) => a.id.localeCompare(b.id))])) });
    return 'absent';
  }
  const fields = entity === 'notebooks' ? ['id', 'title', 'order', 'createdAt'] : entity === 'sections' ? ['id', 'title', 'color', 'order', 'notebookId'] : ['id', 'title', 'order', 'sectionId', 'createdAt', 'camera', 'background'];
  const value = Object.fromEntries(fields.map(key => [key, record[key]]));
  value.deleted = !!record.deletedAt;
  if (entity === 'pages' && !value.deleted) {
    const portable = portableElements(elements);
    value.elements = Object.fromEntries(Object.entries(portable).map(([key, rows]) => [key, [...rows].sort((a, b) => a.id.localeCompare(b.id))]));
  }
  return stable(value);
}
export async function versionHash(entity, record, elements) {
  const canonical = canonicalVersion(entity, record, elements);
  if (canonical === 'absent') return null;
  const bytes = new TextEncoder().encode(canonical);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function cloudElementsFor(cloud, pageId) {
  const result = { strokes: [], shapes: [], textBlocks: [] };
  const table = { stroke: 'strokes', shape: 'shapes', textBlock: 'textBlocks' };
  for (const row of cloud.elements) if (row.pageId === pageId && !row.deletedAt) result[table[row.type]].push(row.data);
  return result;
}
