const setupByClient = new WeakMap();
const invalidate = (owner, id) => `DELETE FROM notes_page_revisions_v1 WHERE user_id=${owner} AND page_id=${id};`;

export async function ensurePageRevisions(client) {
  if (!setupByClient.has(client)) {
    const statements = ['CREATE TABLE IF NOT EXISTS notes_page_revisions_v1(user_id TEXT NOT NULL,page_id TEXT NOT NULL,revision TEXT,PRIMARY KEY(user_id,page_id))'];
    for (const table of ['pages', 'page_elements']) {
      const id = table === 'pages' ? 'id' : 'page_id';
      for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
        const sql = event === 'UPDATE' ? invalidate('OLD.user_id', `OLD.${id}`) + invalidate('NEW.user_id', `NEW.${id}`) : invalidate(`${event === 'DELETE' ? 'OLD' : 'NEW'}.user_id`, `${event === 'DELETE' ? 'OLD' : 'NEW'}.${id}`);
        statements.push(`CREATE TRIGGER IF NOT EXISTS notes_revision_${table}_${event.toLowerCase()}_v1 AFTER ${event} ON ${table} BEGIN ${sql} END`);
      }
    }
    const setup = client.batch(statements, 'write');
    setupByClient.set(client, setup);
    void setup.catch(() => setupByClient.delete(client));
  }
  await setupByClient.get(client);
}

export async function savePageRevision(tx, userId, pageId, revision) {
  await tx.execute({ sql: 'INSERT INTO notes_page_revisions_v1(user_id,page_id,revision) VALUES(?,?,?) ON CONFLICT(user_id,page_id) DO UPDATE SET revision=excluded.revision', args: [userId, pageId, revision] });
}
