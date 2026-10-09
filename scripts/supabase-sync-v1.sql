-- Run in Supabase SQL Editor after reviewing on a temporary database.
-- Existing notes are untouched. Direct writes are retired; authenticated RPC is the writer.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pages' AND column_name IN ('camera','background') AND data_type NOT IN ('json','jsonb')) THEN
    RAISE EXCEPTION 'Review legacy camera/background columns before installing this migration; JSON or JSONB is required';
  END IF;
END; $$;
DO $$
DECLARE target text; policy_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY['notebooks','sections','pages','page_elements'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',target);
    FOR policy_name IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=target LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',policy_name,target);
    END LOOP;
    EXECUTE format('CREATE POLICY notes_owner_read ON public.%I FOR SELECT TO authenticated USING (user_id = auth.jwt()->>''sub'')',target);
  END LOOP;
END;
$$;
ALTER TABLE public.page_elements ADD COLUMN IF NOT EXISTS schema_version integer DEFAULT 1;
CREATE TABLE IF NOT EXISTS public.notes_assets (
  user_id text NOT NULL, id text NOT NULL, path text NOT NULL, hash text NOT NULL,
  mime text NOT NULL, PRIMARY KEY(user_id,id)
);
ALTER TABLE public.notes_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notes_assets_read ON public.notes_assets;
DROP POLICY IF EXISTS notes_assets_insert ON public.notes_assets;
CREATE POLICY notes_assets_read ON public.notes_assets FOR SELECT TO authenticated USING (user_id = auth.jwt()->>'sub');
CREATE POLICY notes_assets_insert ON public.notes_assets FOR INSERT TO authenticated WITH CHECK (user_id = auth.jwt()->>'sub' AND path LIKE user_id || '/%' AND hash ~ '^[a-f0-9]{64}$');
GRANT SELECT,INSERT ON public.notes_assets TO authenticated;

CREATE OR REPLACE FUNCTION public.notes_pull_v1() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'notebooks', coalesce((SELECT jsonb_agg(to_jsonb(n)) FROM public.notebooks n WHERE n.user_id = auth.jwt()->>'sub'), '[]'::jsonb),
    'sections', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM public.sections s WHERE s.user_id = auth.jwt()->>'sub'), '[]'::jsonb),
    'pages', coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM public.pages p WHERE p.user_id = auth.jwt()->>'sub'), '[]'::jsonb),
    'elements', coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM public.page_elements e WHERE e.user_id = auth.jwt()->>'sub'), '[]'::jsonb)
  ) WHERE auth.jwt()->>'sub' IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.notes_commit_v1(
  entity text, entity_id text, operation text, expected_record jsonb,
  expected_elements jsonb, new_record jsonb, new_bundle text, asset_ids jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  owner text := auth.jwt()->>'sub';
  previous jsonb;
  elements jsonb;
  stamp bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  parent text;
  image_id text;
BEGIN
  IF owner IS NULL OR entity NOT IN ('notebooks','sections','pages') OR operation NOT IN ('put','delete') OR entity_id IS NULL OR length(entity_id) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid operation' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(entity || ':' || entity_id,0));
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',entity) INTO previous USING entity_id;
  IF previous IS NOT NULL AND previous->>'user_id' <> owner THEN RAISE EXCEPTION 'occupied id' USING ERRCODE='40001'; END IF;
  IF previous IS DISTINCT FROM nullif(expected_record,'null'::jsonb) THEN RAISE EXCEPTION 'revision conflict' USING ERRCODE='40001'; END IF;
  IF entity='pages' THEN
    PERFORM 1 FROM public.page_elements e WHERE e.page_id=entity_id AND e.user_id=owner FOR UPDATE;
    SELECT coalesce(jsonb_object_agg(e.id,to_jsonb(e)), '{}'::jsonb) INTO elements FROM public.page_elements e WHERE e.page_id=entity_id AND e.user_id=owner;
    IF elements IS DISTINCT FROM coalesce(expected_elements,'{}'::jsonb) THEN RAISE EXCEPTION 'content conflict' USING ERRCODE='40001'; END IF;
  END IF;
  IF operation='delete' THEN
    EXECUTE format('UPDATE public.%I SET deleted_at=$1,updated_at=$1 WHERE id=$2 AND user_id=$3',entity) USING stamp,entity_id,owner;
    RETURN jsonb_build_object('committed',true);
  END IF;
  IF new_record->>'id' IS DISTINCT FROM entity_id OR jsonb_typeof(new_record->'title') <> 'string' OR length(new_record->>'title') > 10000 OR jsonb_typeof(new_record->'order') <> 'number' THEN
    RAISE EXCEPTION 'invalid record' USING ERRCODE='22023';
  END IF;
  IF entity='sections' THEN
    parent:=new_record->>'notebookId';
    PERFORM 1 FROM public.notebooks WHERE id=parent AND user_id=owner AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing parent' USING ERRCODE='40001'; END IF;
  END IF;
  IF entity='pages' THEN
    parent:=new_record->>'sectionId';
    PERFORM 1 FROM public.sections WHERE id=parent AND user_id=owner AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND OR new_bundle IS NULL OR octet_length(new_bundle)>4194304 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
    FOR image_id IN SELECT jsonb_array_elements_text(coalesce(asset_ids,'[]'::jsonb)) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.notes_assets WHERE user_id=owner AND id=image_id) THEN RAISE EXCEPTION 'missing image' USING ERRCODE='40001'; END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.page_elements WHERE id='bundle_' || entity_id AND user_id<>owner) THEN RAISE EXCEPTION 'occupied bundle' USING ERRCODE='40001'; END IF;
  END IF;
  IF entity='notebooks' THEN
    INSERT INTO public.notebooks(id,user_id,title,created_at,updated_at,"order",deleted_at) VALUES(entity_id,owner,new_record->>'title',(new_record->>'createdAt')::bigint,stamp,(new_record->>'order')::numeric,NULL)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,"order"=excluded."order",updated_at=excluded.updated_at,deleted_at=NULL WHERE notebooks.user_id=owner;
  ELSIF entity='sections' THEN
    INSERT INTO public.sections(id,user_id,notebook_id,title,color,"order",updated_at,deleted_at) VALUES(entity_id,owner,parent,new_record->>'title',new_record->>'color',(new_record->>'order')::numeric,stamp,NULL)
    ON CONFLICT(id) DO UPDATE SET notebook_id=excluded.notebook_id,title=excluded.title,color=excluded.color,"order"=excluded."order",updated_at=excluded.updated_at,deleted_at=NULL WHERE sections.user_id=owner;
  ELSE
    INSERT INTO public.pages(id,user_id,section_id,title,created_at,updated_at,"order",camera,background,deleted_at) VALUES(entity_id,owner,parent,new_record->>'title',(new_record->>'createdAt')::bigint,stamp,(new_record->>'order')::numeric,new_record->'camera',new_record->'background',NULL)
    ON CONFLICT(id) DO UPDATE SET section_id=excluded.section_id,title=excluded.title,"order"=excluded."order",camera=excluded.camera,background=excluded.background,updated_at=excluded.updated_at,deleted_at=NULL WHERE pages.user_id=owner;
    INSERT INTO public.page_elements(id,user_id,page_id,type,data,updated_at,deleted_at,schema_version) VALUES('bundle_' || entity_id,owner,entity_id,'bundle',new_bundle,stamp,NULL,2)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,deleted_at=NULL,schema_version=2 WHERE page_elements.user_id=owner;
  END IF;
  RETURN jsonb_build_object('committed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_pull_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notes_commit_v1(text,text,text,jsonb,jsonb,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notes_pull_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notes_commit_v1(text,text,text,jsonb,jsonb,jsonb,text,jsonb) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.notebooks,public.sections,public.pages,public.page_elements FROM authenticated,anon;
REVOKE SELECT ON public.notebooks,public.sections,public.pages,public.page_elements FROM anon;
GRANT SELECT ON public.notebooks,public.sections,public.pages,public.page_elements TO authenticated;
COMMIT;

-- Storage setup (Supabase only, not part of the isolated PostgreSQL schema test).
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('notes-assets','notes-assets',false,52428800,ARRAY['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp','image/x-icon'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
DROP POLICY IF EXISTS notes_asset_files_read ON storage.objects;
DROP POLICY IF EXISTS notes_asset_files_insert ON storage.objects;
CREATE POLICY notes_asset_files_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='notes-assets' AND (storage.foldername(name))[1]=auth.jwt()->>'sub');
CREATE POLICY notes_asset_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='notes-assets' AND (storage.foldername(name))[1]=auth.jwt()->>'sub');
