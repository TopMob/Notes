const setupByClient = new WeakMap();
const upsert = owner => `INSERT INTO notes_sync_clock(user_id,token) VALUES(${owner},lower(hex(randomblob(16)))) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token;`;

export async function ensureSyncClock(client) {
  if (!setupByClient.has(client)) {
    const statements = ['CREATE TABLE IF NOT EXISTS notes_sync_clock(user_id TEXT PRIMARY KEY,token TEXT NOT NULL)'];
    for (const table of ['notebooks', 'sections', 'pages', 'page_elements']) {
      if (table !== 'page_elements') statements.push(`CREATE INDEX IF NOT EXISTS notes_${table}_owner ON ${table}(user_id)`);
      for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
        const changes = event === 'UPDATE'
          ? `${upsert('NEW.user_id')}INSERT INTO notes_sync_clock(user_id,token) SELECT OLD.user_id,lower(hex(randomblob(16))) WHERE OLD.user_id IS NOT NEW.user_id ON CONFLICT(user_id) DO UPDATE SET token=excluded.token;`
          : upsert(event === 'DELETE' ? 'OLD.user_id' : 'NEW.user_id');
        statements.push(`CREATE TRIGGER IF NOT EXISTS notes_clock_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN ${changes} END`);
      }
    }
    statements.push('CREATE INDEX IF NOT EXISTS notes_elements_page_owner ON page_elements(user_id,page_id)');
    const setup = client.batch(statements, 'write');
    setupByClient.set(client, setup);
    void setup.catch(() => setupByClient.delete(client));
  }
  await setupByClient.get(client);
}

export async function readSyncClock(client, userId) {
  const result = await client.execute({ sql: 'SELECT token FROM notes_sync_clock WHERE user_id=?', args: [userId] });
  return result.rows[0]?.token;
}

export async function getSyncClock(client, userId) {
  await ensureSyncClock(client);
  let token = await readSyncClock(client, userId);
  if (!token) {
    await client.execute({ sql: 'INSERT INTO notes_sync_clock(user_id,token) VALUES(?,lower(hex(randomblob(16)))) ON CONFLICT(user_id) DO NOTHING', args: [userId] });
    token = await readSyncClock(client, userId);
  }
  return token;
}
