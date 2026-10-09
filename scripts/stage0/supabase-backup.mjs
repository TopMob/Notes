// Requires administrator connection configured through PG* environment variables.
// No credentials in command arguments; no source data writes or migrations.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function run(binary, args, output) {
  const handle = output ? await open(output, 'wx') : null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', handle ? handle.fd : 'ignore', 'ignore'] });
      child.on('error', () => reject(new Error('PostgreSQL tools unavailable')));
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('PostgreSQL capture failed')));
    });
  } finally { await handle?.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') throw new Error('Usage: node scripts/stage0/supabase-backup.mjs --out <NEW directory>');
  if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER) throw new Error('Set PGHOST, PGDATABASE, PGUSER and connection authentication privately');
  if (process.env.PGSERVICE || process.env.PGSERVICEFILE) throw new Error('Use explicit PG* connection settings, not an ambiguous service override');
  const output = resolve(args[1]);
  await run('pg_dump', ['--version']);
  await run('psql', ['--version']);
  await mkdir(output); // Existing directories are never overwritten.
  const dump = resolve(output, 'supabase-public.dump');
  await run('pg_dump', ['--no-password', '--format=custom', '--no-owner', '--no-acl', '--schema=public', '--file', dump]);
  await run('psql', ['--no-password', '-X', '-v', 'ON_ERROR_STOP=1', '--file', fileURLToPath(new URL('./supabase-inspect-readonly.sql', import.meta.url))], resolve(output, 'permissions-readonly.txt'));
  const files = {};
  for (const name of ['supabase-public.dump', 'permissions-readonly.txt']) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(resolve(output, name))) hash.update(chunk);
    files[name] = { bytes: (await stat(resolve(output, name))).size, sha256: hash.digest('hex') };
  }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), kind: 'postgres-custom-dump', scope: 'public schema only', files, consistency: 'pg_dump database snapshot; permissions captured in a separate readonly transaction', storageObjectsIncluded: false, rolesIncluded: false, restoreVerified: false }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ captured: true, restoreVerified: false, storageObjectsIncluded: false }));
}
main().catch(() => { console.error('Supabase capture unavailable or failed. No source writes performed. Check connection and PostgreSQL tools privately. A directory without a manifest is an incomplete capture.'); process.exitCode = 1; });
