import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SignJWT, generateKeyPair } from 'jose';
import { authenticate, clerkIssuer } from '../../server/sync-auth.mjs';
import { commit, pull, ensureAssets, putAsset, completeAsset, assetManifest, pack, decode } from '../../server/turso-sync.mjs';
import { versionHash, cloudElementsFor } from '../../src/services/sync/protocol.mjs';

async function fixture() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(`CREATE TABLE notebooks(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,created_at INTEGER,updated_at INTEGER,"order" INTEGER,deleted_at INTEGER);
  CREATE TABLE sections(id TEXT PRIMARY KEY,user_id TEXT,notebook_id TEXT,title TEXT,color TEXT,"order" INTEGER,updated_at INTEGER,deleted_at INTEGER);
  CREATE TABLE pages(id TEXT PRIMARY KEY,user_id TEXT,section_id TEXT,title TEXT,created_at INTEGER,updated_at INTEGER,"order" INTEGER,camera TEXT,background TEXT,deleted_at INTEGER);
  CREATE TABLE page_elements(id TEXT PRIMARY KEY,user_id TEXT,page_id TEXT,type TEXT,data TEXT,updated_at INTEGER,deleted_at INTEGER);`);
  const notebook = { id: 'n', title: 'Fixture', order: 0, createdAt: 1 };
  const section = { id: 's', notebookId: 'n', title: 'Fixture', color: '#123456', order: 0 };
  await commit(client, 'u', { entity: 'notebooks', id: 'n', action: 'put', expected: null, record: notebook });
  await commit(client, 'u', { entity: 'sections', id: 's', action: 'put', expected: null, record: section });
  const page = { id: 'p', sectionId: 's', title: 'First', createdAt: 1, order: 0, camera: { x: 0, y: 0, zoom: 1 }, background: 'grid-small' };
  const elements = { strokes: [], shapes: [], textBlocks: [{ id: 't', pageId: 'p', x: 0, y: 0, width: 200, zIndex: 0, contentHTML: '<p>first</p>' }] };
  return { client, page, elements };
}
test('server page commit is atomic, conditional and retryable after a lost response', async () => {
  const { client, page, elements } = await fixture();
  try {
    const first = await commit(client, 'u', { entity: 'pages', id: 'p', action: 'put', expected: null, record: page, elements });
    assert.equal(first.revision, await versionHash('pages', page, elements));
    const next = { ...page, title: 'Device A' };
    const request = { entity: 'pages', id: 'p', action: 'put', expected: first.revision, record: next, elements };
    const committed = await commit(client, 'u', request);
    assert.deepEqual(await commit(client, 'u', request), committed);
    await assert.rejects(commit(client, 'u', { ...request, record: { ...page, title: 'Device B' } }), e => e.status === 409);
    const cloud = await pull(client, 'u');
    assert.equal(cloud.pages[0].title, 'Device A'); assert.deepEqual(cloudElementsFor(cloud, 'p'), elements);
    const missingImage = { ...elements, textBlocks: [{ ...elements.textBlocks[0], contentHTML: '<img data-asset-id="missing" src="blob:fixture">' }] };
    await ensureAssets(client);
    await assert.rejects(commit(client, 'u', { ...request, expected: committed.revision, record: { ...next, title: 'Must rollback' }, elements: missingImage }), e => e.status === 409);
    assert.equal((await pull(client, 'u')).pages[0].title, 'Device A');
  } finally { client.close(); }
});
test('server refuses cross-owner IDs and never cascades an unchecked deletion', async () => {
  const { client, page, elements } = await fixture();
  try {
    await commit(client, 'u', { entity: 'pages', id: 'p', action: 'put', expected: null, record: page, elements });
    await assert.rejects(commit(client, 'other', { entity: 'pages', id: 'p', action: 'put', expected: null, record: page, elements }), e => e.status === 409);
    const cloud = await pull(client, 'u');
    await commit(client, 'u', { entity: 'notebooks', id: 'n', action: 'delete', expected: await versionHash('notebooks', cloud.notebooks[0]) });
    const after = await pull(client, 'u');
    assert.ok(after.notebooks[0].deletedAt); assert.equal(after.sections[0].deletedAt, null); assert.equal(after.pages[0].deletedAt, null);
    assert.equal((await pull(client, 'other')).pages.length, 0);
  } finally { client.close(); }
});
test('binary asset parts are resumable, immutable, scoped and checksum verified', async () => {
  const { client } = await fixture();
  try {
    await ensureAssets(client);
    const bytes = Buffer.from([0, 255, 128, 1, 2, 0, 123]);
    const input = { id: 'asset_test', total: 2, hash: createHash('sha256').update(bytes).digest('hex'), mime: 'image/png' };
    await putAsset(client, 'u', { ...input, part: 1 }, bytes.subarray(3));
    assert.equal(await completeAsset(client, 'u', input.id), null);
    await putAsset(client, 'u', { ...input, part: 0 }, bytes.subarray(0, 3));
    await putAsset(client, 'u', { ...input, part: 0 }, bytes.subarray(0, 3));
    assert.deepEqual((await completeAsset(client, 'u', input.id)).data, bytes);
    assert.equal(await completeAsset(client, 'other', input.id), null);
    await assert.rejects(putAsset(client, 'u', { ...input, part: 0, hash: '0'.repeat(64) }, bytes), e => e.status === 409);
    await client.execute({ sql: 'UPDATE notes_asset_chunks SET data=? WHERE user_id=? AND id=? AND part=0', args: [Buffer.from('corrupt'), 'u', input.id] });
    await assert.rejects(completeAsset(client, 'u', input.id), e => e.status === 502);
  } finally { client.close(); }
});
test('an orphan cloud canvas has its own revision and cannot be replaced as an absent page', async () => {
  const { client, page, elements } = await fixture();
  try {
    await client.execute({ sql: 'INSERT INTO page_elements(id,user_id,page_id,type,data,updated_at,deleted_at) VALUES(?,?,?,?,?,?,NULL)', args: ['t','u','p','textBlock',JSON.stringify(elements.textBlocks[0]),1] });
    const orphanHash = await versionHash('pages', null, elements);
    assert.ok(orphanHash);
    await assert.rejects(commit(client, 'u', {entity:'pages',id:'p',action:'put',expected:null,record:page,elements:{strokes:[],shapes:[],textBlocks:[]}}), e => e.status === 409);
    await commit(client,'u',{entity:'pages',id:'p',action:'put',expected:orphanHash,record:page,elements});
    assert.equal((await pull(client,'u')).pages.length,1);
    assert.deepEqual(cloudElementsFor(await pull(client,'u'),'p'), elements);
  } finally { client.close(); }
});
test('Clerk verification checks signature, issuer, expiry and authorized origin', async () => {
  const env = { VITE_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('fixture.clerk.accounts.dev$').toString('base64')}` };
  const issuer = clerkIssuer(env); const { publicKey, privateKey } = await generateKeyPair('RS256');
  const token = async claims => new SignJWT({ azp: 'https://infiniti-note.vercel.app', ...claims }).setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setSubject('fixture-user').setNotBefore('0s').setExpirationTime('2m').sign(privateKey);
  assert.equal(await authenticate({ authorization: `Bearer ${await token({})}` }, env, publicKey), 'fixture-user');
  await assert.rejects(authenticate({}, env, publicKey), e => e.status === 401);
  await assert.rejects(authenticate({ authorization: `Bearer ${await token({ azp: 'https://untrusted.example' })}` }, env, publicKey), e => e.status === 401);
  await assert.rejects(authenticate({ authorization: `Bearer ${await token({ sts: 'pending' })}` }, env, publicKey), e => e.status === 401);
  const expired = await new SignJWT({ azp: 'https://infiniti-note.vercel.app' }).setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setSubject('fixture-user').setNotBefore(1).setExpirationTime(2).sign(privateKey);
  await assert.rejects(authenticate({ authorization: `Bearer ${expired}` }, env, publicKey), e => e.status === 401);
  const { publicKey: wrongKey } = await generateKeyPair('RS256');
  await assert.rejects(authenticate({ authorization: `Bearer ${await token({})}` }, env, wrongKey), e => e.status === 401);
});
test('actual Turso transport compresses large pages and round-trips multi-megabyte binary assets in bounded parts', async () => {
  const require = createRequire(import.meta.url); const ts = require('typescript');
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(new URL('../../src/services/sync/tursoProvider.ts', import.meta.url),'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  Function('require','module','exports',js)(name => { if (name === './compression') return {compressJson:async value=>pack(value),decompressJson:async value=>decode(value)}; throw Error(`Unexpected runtime import ${name}`); }, module, module.exports);
  const { client, page, elements } = await fixture();
  const originalFetch = globalThis.fetch; let maxBytes = 0, uploads = 0;
  const headersFor = manifest => ({ 'Content-Type':manifest.mime,'X-Asset-Hash':manifest.hash,'X-Asset-Parts':String(manifest.total),'X-Asset-Size':String(manifest.size) });
  globalThis.fetch = async (path, options) => {
    assert.equal(options.headers.Authorization,'Bearer fixture');
    const url = new URL(path,'https://fixture');
    try {
      if (options.method === 'POST') {
        maxBytes=Math.max(maxBytes,Buffer.byteLength(options.body));
        const body=JSON.parse(options.body);
        return Response.json(body.action==='pull'?{payload:pack(await pull(client,'u'))}:await commit(client,'u',decode(body.payload)));
      }
      await ensureAssets(client); const id=url.searchParams.get('id');
      if (options.method==='PUT') {
        const bytes=Buffer.from(await options.body.arrayBuffer()); maxBytes=Math.max(maxBytes,bytes.length); uploads++;
        await putAsset(client,'u',{id,part:Number(url.searchParams.get('part')),total:Number(url.searchParams.get('total')),hash:url.searchParams.get('hash'),mime:options.headers['X-Asset-Mime']},bytes);
        return Response.json({saved:true});
      }
      const manifest=await assetManifest(client,'u',id);
      if (!manifest) return new Response(null,{status:404});
      if (options.method==='HEAD') return new Response(null,{headers:headersFor(manifest)});
      const result=await client.execute({sql:'SELECT data FROM notes_asset_chunks WHERE user_id=? AND id=? AND part=?',args:['u',id,Number(url.searchParams.get('part'))]});
      const bytes=Buffer.from(result.rows[0].data); maxBytes=Math.max(maxBytes,bytes.length);
      return new Response(bytes,{headers:headersFor(manifest)});
    } catch (error) { return Response.json({error:error.message},{status:error.status||502}); }
  };
  try {
    const provider=new module.exports.TursoProvider(); provider.setTokenProvider(async ()=>'fixture');
    const large={...elements,textBlocks:[{...elements.textBlocks[0],contentHTML:'<p>'+('Русский текст '.repeat(250000))+'</p>'}]};
    assert.ok(Buffer.byteLength(JSON.stringify(large))>3*1024*1024);
    await provider.commit('u',{entity:'pages',id:'p',action:'put',expected:null,record:page,elements:large});
    const cloud=await provider.pullAll('u'); assert.equal(cloud.elements[0].data.contentHTML,large.textBlocks[0].contentHTML);
    const bytes=Buffer.alloc(5*1024*1024+7); for(let i=0;i<bytes.length;i++) bytes[i]=(i*31)%256;
    const blob=new Blob([bytes],{type:'image/png'});
    await provider.uploadAsset('asset_transport',blob);
    const count=uploads; await provider.uploadAsset('asset_transport',blob); assert.equal(uploads,count);
    assert.deepEqual(Buffer.from(await (await provider.downloadAsset('asset_transport')).arrayBuffer()),bytes);
    assert.ok(maxBytes<=512*1024,'A transport request/part exceeded its bound');
  } finally { globalThis.fetch=originalFetch; client.close(); }
});
