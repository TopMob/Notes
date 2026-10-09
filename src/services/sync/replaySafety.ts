import type { CloudPullResult } from './types';
import type { readOutboxSnapshot } from './outbox';

function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sameFields(local: any, remote: any, fields: string[]) {
  return fields.every(key => stable(local[key]) === stable(remote[key]));
}

// An interrupted old session is not proof that its pending change may replace today's cloud data.
export function checkOutboxReplay(snapshot: NonNullable<Awaited<ReturnType<typeof readOutboxSnapshot>>>, cloud: CloudPullResult): 'new' | 'acknowledged' | 'conflict' {
  const entry = snapshot.entry;
  const remote = cloud[entry.entity].find(row => row.id === entry.entityId);
  if (entry.action === 'delete' || snapshot.record?.deletedAt) return !remote || remote.deletedAt ? 'acknowledged' : 'conflict';
  if (!remote) {
    if (entry.entity === 'pages' && cloud.elements.some(element => element.pageId === entry.entityId)) return 'conflict';
    return 'new';
  }
  if (!snapshot.record || remote.deletedAt) return 'conflict';
  const fields = entry.entity === 'notebooks' ? ['title', 'order'] : entry.entity === 'sections' ? ['title', 'color', 'order', 'notebookId'] : ['title', 'order', 'sectionId', 'camera', 'background'];
  if (!sameFields(snapshot.record, remote, fields)) return 'conflict';
  if (entry.entity !== 'pages') return 'acknowledged';
  const localElements = [...(snapshot.elements?.strokes || []), ...(snapshot.elements?.shapes || []), ...(snapshot.elements?.textBlocks || [])];
  const remoteElements = cloud.elements.filter(element => element.pageId === entry.entityId && !element.deletedAt).map(element => element.data);
  if (localElements.length !== remoteElements.length) return 'conflict';
  const remoteById = new Map(remoteElements.map(record => [record.id, record]));
  return localElements.every(record => remoteById.has(record.id) && stable(record) === stable(remoteById.get(record.id))) ? 'acknowledged' : 'conflict';
}
