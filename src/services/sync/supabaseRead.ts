import type { SupabaseClient } from '@supabase/supabase-js';

export async function readSupabaseRows(client: SupabaseClient, table: string, userId: string, since: number) {
  const rows: Record<string, any>[] = [];
  let cursor: string | null = null;
  for (let batch = 0; batch < 1000; batch++) {
    let query = client.from(table).select('*').eq('user_id', userId).order('id').limit(500);
    if (since > 0) query = query.gt('updated_at', since);
    if (cursor !== null) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Неполный ответ Supabase; синхронизация остановлена');
    if (!data.length) return rows;
    const next = data[data.length - 1]?.id;
    if (typeof next !== 'string' || !next || next === cursor) throw new Error('Некорректная пагинация Supabase');
    rows.push(...data); cursor = next;
    // Continue until an empty page: server-side limits may be lower than our limit.
  }
  throw new Error('Слишком большой ответ Supabase. Частичные данные не применены.');
}
