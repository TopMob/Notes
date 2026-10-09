-- Read-only inspection for an existing administrator connection.
-- Does not apply policies, change roles, or probe permissions by writing.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT current_database() AS database_name, current_user AS inspecting_role,
       current_setting('server_version') AS postgres_version;

SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('notebooks', 'sections', 'pages', 'page_elements', 'notes_sync_state', 'assets')
  AND c.relkind = 'r' ORDER BY c.relname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('notebooks', 'sections', 'pages', 'page_elements', 'notes_sync_state', 'assets')
ORDER BY tablename, policyname;

SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('notebooks', 'sections', 'pages', 'page_elements', 'notes_sync_state', 'assets')
ORDER BY table_name, grantee, privilege_type;

SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname IN (current_user, 'anon', 'authenticated', 'service_role');
ROLLBACK;
