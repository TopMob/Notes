-- ============================================================================
-- SQL-миграция: Включение Row Level Security (RLS) для OneNote Clone
-- Интеграция с Clerk Authentication через JWT claims (sub = user_id)
-- ============================================================================

-- 1. Включаем RLS для всех таблиц приложения
ALTER TABLE IF EXISTS notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS page_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notes_sync_state ENABLE ROW LEVEL SECURITY;

-- 2. Аддитивная колонка: schema_version для версионирования сжатия и бандлов
ALTER TABLE IF EXISTS page_elements ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 1;

-- 3. Удаляем старые/открытые политики, если они существовали
DROP POLICY IF EXISTS "Users can manage own notebooks" ON notebooks;
DROP POLICY IF EXISTS "Users can manage own sections" ON sections;
DROP POLICY IF EXISTS "Users can manage own pages" ON pages;
DROP POLICY IF EXISTS "Users can manage own page_elements" ON page_elements;
DROP POLICY IF EXISTS "Users can manage own sync state" ON notes_sync_state;

DROP POLICY IF EXISTS "Allow authenticated users to manage own notebooks" ON notebooks;
DROP POLICY IF EXISTS "Allow authenticated users to manage own sections" ON sections;
DROP POLICY IF EXISTS "Allow authenticated users to manage own pages" ON pages;
DROP POLICY IF EXISTS "Allow authenticated users to manage own page_elements" ON page_elements;
DROP POLICY IF EXISTS "Allow authenticated users to manage own sync state" ON notes_sync_state;

-- 4. Политики безопасности: доступ разрешён ТОЛЬКО авторизованным пользователям
--    Идентификатор пользователя сверяется с JWT claims от Clerk (sub / user_id)

CREATE POLICY "Allow authenticated users to manage own notebooks"
ON notebooks FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
);

CREATE POLICY "Allow authenticated users to manage own sections"
ON sections FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
);

CREATE POLICY "Allow authenticated users to manage own pages"
ON pages FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
);

CREATE POLICY "Allow authenticated users to manage own page_elements"
ON page_elements FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
);

CREATE POLICY "Allow authenticated users to manage own sync state"
ON notes_sync_state FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'sub', auth.jwt() ->> 'user_id', auth.uid()::text) = user_id
);
