import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Supabase SQL installs without changing notes and enforces CAS, atomic bundles and owner permissions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb $$;
      GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
      CREATE TABLE notebooks(id text PRIMARY KEY,user_id text,title text,created_at bigint,updated_at bigint,"order" integer,deleted_at bigint);
      CREATE TABLE sections(id text PRIMARY KEY,user_id text,notebook_id text,title text,color text,"order" integer,updated_at bigint,deleted_at bigint);
      CREATE TABLE pages(id text PRIMARY KEY,user_id text,section_id text,title text,created_at bigint,updated_at bigint,"order" integer,camera jsonb,background jsonb,deleted_at bigint);
      CREATE TABLE page_elements(id text PRIMARY KEY,user_id text,page_id text,type text,data text,updated_at bigint,deleted_at bigint);
      CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(bucket_id text,name text);
      CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
      INSERT INTO notebooks VALUES('existing','other','Keep existing',1,1,0,NULL);`);
    const migration = await readFile(new URL('../supabase-sync-v1.sql', import.meta.url), 'utf8');
    await db.exec(migration); await db.exec(migration);
    assert.equal((await db.query('SELECT title FROM notebooks WHERE id=$1', ['existing'])).rows[0].title, 'Keep existing');
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"u"}',false);`);
    assert.equal((await db.query('SELECT * FROM notebooks')).rows.length, 0);
    await assert.rejects(db.query(`INSERT INTO notebooks VALUES('bad','u','No',1,1,0,NULL)`), e => e.code === '42501');
    const commit = (entity, id, record, previous = null, elements = {}, bundle = null, assets = [], action = 'put') => db.query('SELECT notes_commit_v1($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb)', [entity,id,action,JSON.stringify(previous),JSON.stringify(elements),JSON.stringify(record),bundle,JSON.stringify(assets)]);
    await commit('notebooks','n',{id:'n',title:'Fixture',createdAt:1,order:0});
    await commit('sections','s',{id:'s',notebookId:'n',title:'Fixture',color:'red',order:0});
    const page = {id:'p',sectionId:'s',title:'First',createdAt:1,order:0,camera:{x:0,y:0,zoom:1},background:'plain'};
    await commit('pages','p',page,null,{},'first bundle');
    const raw = (await db.query('SELECT to_jsonb(p) AS record FROM pages p WHERE id=$1',['p'])).rows[0].record;
    const elements = (await db.query(`SELECT jsonb_object_agg(e.id,to_jsonb(e)) AS records FROM page_elements e WHERE page_id='p'`)).rows[0].records;
    await commit('pages','p',{...page,title:'Device A'},raw,elements,'second bundle');
    await assert.rejects(commit('pages','p',{...page,title:'Device B'},raw,elements,'third bundle'), e => e.code === '40001');
    assert.equal((await db.query('SELECT title FROM pages WHERE id=$1',['p'])).rows[0].title,'Device A');
    const rawA = (await db.query('SELECT to_jsonb(p) AS record FROM pages p WHERE id=$1',['p'])).rows[0].record;
    const elementsA = (await db.query(`SELECT jsonb_object_agg(e.id,to_jsonb(e)) AS records FROM page_elements e WHERE page_id='p'`)).rows[0].records;
    await assert.rejects(commit('pages','p',{...page,title:'Must rollback'},rawA,elementsA,'missing asset bundle',['missing']), e => e.code === '40001');
    assert.equal((await db.query('SELECT title FROM pages WHERE id=$1',['p'])).rows[0].title,'Device A');
    assert.equal((await db.query('SELECT data FROM page_elements WHERE id=$1',['bundle_p'])).rows[0].data,'second bundle');
    await assert.rejects(commit('notebooks','existing',{id:'existing',title:'Must not touch',createdAt:1,order:0}), e => e.code === '40001');
    const pulled = (await db.query('SELECT notes_pull_v1() AS snapshot')).rows[0].snapshot;
    assert.equal(pulled.notebooks.length,1); assert.equal(pulled.pages.length,1);
    await db.exec(`SELECT set_config('request.jwt.claims','{"sub":"other"}',false);`);
    assert.equal((await db.query('SELECT notes_pull_v1() AS snapshot')).rows[0].snapshot.pages.length,0);
  } finally { await db.close(); }
});
