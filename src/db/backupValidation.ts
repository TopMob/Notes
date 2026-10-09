const tables = ['notebooks', 'sections', 'pages', 'strokes', 'shapes', 'textBlocks'] as const;
type RecordValue = Record<string, unknown> & { id: string };
export interface ValidatedLegacyBackup {
  version: 1;
  data: Record<typeof tables[number], RecordValue[]>;
}

export function validateLegacyBackup(value: unknown): ValidatedLegacyBackup {
  const fail = () => { throw new Error('Некорректная или неполная резервная копия. Текущие заметки не изменены.'); };
  if (!value || typeof value !== 'object') return fail();
  const backup = value as Record<string, unknown>;
  if (backup.version !== 1 || !backup.data || typeof backup.data !== 'object') return fail();
  const data = backup.data as Record<string, unknown>;
  const ids = new Map<string, Set<string>>();
  for (const table of tables) {
    const rows = data[table];
    if (!Array.isArray(rows)) return fail();
    const seen = new Set<string>();
    ids.set(table, seen);
    for (const record of rows) {
      if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id.trim() || seen.has(record.id)) return fail();
      seen.add(record.id);
      if (['notebooks', 'sections', 'pages'].includes(table) && (typeof record.title !== 'string' || !Number.isFinite(record.order))) return fail();
      if (['notebooks', 'pages'].includes(table) && !Number.isFinite(record.createdAt)) return fail();
      if (table === 'sections' && typeof record.color !== 'string') return fail();
      if (table === 'pages' && (!record.camera || ![record.camera.x, record.camera.y, record.camera.zoom].every(Number.isFinite) || record.camera.zoom <= 0 || !['plain', 'ruled', 'grid-small', 'grid-large'].includes(record.background) || record.slugAliases !== undefined && (!Array.isArray(record.slugAliases) || !record.slugAliases.every((alias: unknown) => typeof alias === 'string')))) return fail();
      if (table === 'textBlocks' && (typeof record.contentHTML !== 'string' || ![record.x, record.y, record.width].every(Number.isFinite) || record.width <= 0)) return fail();
      if (table === 'strokes' && (!Array.isArray(record.points) || !record.points.every((p: Record<string, unknown>) => p && [p.x, p.y].every(Number.isFinite)) || typeof record.color !== 'string')) return fail();
      if (table === 'shapes' && (!['line', 'arrow', 'rect', 'ellipse', 'axis'].includes(record.type) || !record.anchor || !record.end || ![record.anchor.x, record.anchor.y, record.end.x, record.end.y].every(Number.isFinite))) return fail();
      if (['strokes', 'shapes'].includes(table) && (!record.bounds || ![record.bounds.minX, record.bounds.minY, record.bounds.maxX, record.bounds.maxY].every(Number.isFinite))) return fail();
      if (table === 'strokes' && (!Number.isFinite(record.baseWidth) || record.baseWidth <= 0 || !Number.isFinite(record.opacity) || !['pen', 'highlighter'].includes(record.tool))) return fail();
      if (table === 'shapes' && (!record.style || typeof record.style.color !== 'string' || !Number.isFinite(record.style.width) || record.style.width <= 0)) return fail();
    }
  }
  for (const [child, field, parent] of [
    ['sections', 'notebookId', 'notebooks'], ['pages', 'sectionId', 'sections'],
    ['strokes', 'pageId', 'pages'], ['shapes', 'pageId', 'pages'], ['textBlocks', 'pageId', 'pages'],
  ]) for (const record of data[child] as RecordValue[]) {
    if (typeof record[field] !== 'string' || !ids.get(parent)?.has(record[field] as string)) return fail();
  }
  return value as ValidatedLegacyBackup;
}
