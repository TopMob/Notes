import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

// Parse .env manually
const envPath = path.resolve(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

const url = env.VITE_TURSO_DATABASE_URL || env.TURSO_DATABASE_URL;
const authToken = env.VITE_TURSO_AUTH_TOKEN || env.TURSO_AUTH_TOKEN;

const client = createClient({ url, authToken });

async function init() {
  console.log('Connecting to Turso at', url);
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS notes_sync_state (
        user_id TEXT PRIMARY KEY,
        active_provider TEXT DEFAULT 'turso',
        last_synced_at INTEGER
      );
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS notebooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        "order" INTEGER NOT NULL,
        deleted_at INTEGER
      );
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        title TEXT NOT NULL,
        color TEXT NOT NULL,
        "order" INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        section_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        "order" INTEGER NOT NULL,
        camera TEXT,
        background TEXT,
        deleted_at INTEGER
      );
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS page_elements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
    `);

    console.log('✅ All tables successfully created in Turso!');
  } catch (err) {
    console.error('❌ Error creating tables in Turso:', err);
    process.exit(1);
  }
}

init();
