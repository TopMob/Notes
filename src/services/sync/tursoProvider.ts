import { createClient, Client } from '@libsql/client/web';
import { ISyncProvider, CloudPullResult } from './types';
import { Notebook, Section, Page } from '../../types/notebook';
import { Stroke, ShapeObject } from '../../types/canvas';
import { TextBlock } from '../../types/textblock';

export class TursoProvider implements ISyncProvider {
  name: 'turso' = 'turso';
  private client: Client | null = null;

  constructor() {
    const url = import.meta.env.VITE_TURSO_DATABASE_URL || '';
    const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN || '';

    if (url && authToken) {
      this.client = createClient({ url, authToken });
    }
  }

  private getClient(): Client {
    if (!this.client) {
      throw new Error('Turso client is not initialized. Check your VITE_TURSO_DATABASE_URL and VITE_TURSO_AUTH_TOKEN in .env');
    }
    return this.client;
  }

  async pushNotebooks(userId: string, notebooks: Notebook[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    for (const nb of notebooks) {
      await client.execute({
        sql: `
          INSERT INTO notebooks (id, user_id, title, created_at, updated_at, "order", deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            updated_at = excluded.updated_at,
            "order" = excluded."order",
            deleted_at = NULL;
        `,
        args: [nb.id, userId, nb.title, nb.createdAt, now, nb.order],
      });
    }
  }

  async pushSections(userId: string, sections: Section[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    for (const sec of sections) {
      await client.execute({
        sql: `
          INSERT INTO sections (id, user_id, notebook_id, title, color, "order", updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            color = excluded.color,
            "order" = excluded."order",
            updated_at = excluded.updated_at,
            deleted_at = NULL;
        `,
        args: [sec.id, userId, sec.notebookId, sec.title, sec.color, sec.order, now],
      });
    }
  }

  async pushPages(userId: string, pages: Page[]): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    for (const page of pages) {
      await client.execute({
        sql: `
          INSERT INTO pages (id, user_id, section_id, title, created_at, updated_at, "order", camera, background, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            "order" = excluded."order",
            camera = excluded.camera,
            background = excluded.background,
            updated_at = excluded.updated_at,
            deleted_at = NULL;
        `,
        args: [
          page.id,
          userId,
          page.sectionId,
          page.title,
          page.createdAt,
          now,
          page.order,
          JSON.stringify(page.camera || {}),
          JSON.stringify(page.background || {}),
        ],
      });
    }
  }

  async pushPageElements(
    userId: string,
    pageId: string,
    elements: {
      strokes?: Stroke[];
      shapes?: ShapeObject[];
      textBlocks?: TextBlock[];
    }
  ): Promise<void> {
    const client = this.getClient();
    const now = Date.now();

    const statements: { sql: string; args: any[] }[] = [];

    if (elements.strokes) {
      for (const stroke of elements.strokes) {
        statements.push({
          sql: `
            INSERT INTO page_elements (id, user_id, page_id, type, data, updated_at, deleted_at)
            VALUES (?, ?, ?, 'stroke', ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              data = excluded.data,
              updated_at = excluded.updated_at,
              deleted_at = NULL;
          `,
          args: [stroke.id, userId, pageId, JSON.stringify(stroke), now],
        });
      }
    }

    if (elements.shapes) {
      for (const shape of elements.shapes) {
        statements.push({
          sql: `
            INSERT INTO page_elements (id, user_id, page_id, type, data, updated_at, deleted_at)
            VALUES (?, ?, ?, 'shape', ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              data = excluded.data,
              updated_at = excluded.updated_at,
              deleted_at = NULL;
          `,
          args: [shape.id, userId, pageId, JSON.stringify(shape), now],
        });
      }
    }

    if (elements.textBlocks) {
      for (const block of elements.textBlocks) {
        statements.push({
          sql: `
            INSERT INTO page_elements (id, user_id, page_id, type, data, updated_at, deleted_at)
            VALUES (?, ?, ?, 'textBlock', ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              data = excluded.data,
              updated_at = excluded.updated_at,
              deleted_at = NULL;
          `,
          args: [block.id, userId, pageId, JSON.stringify(block), now],
        });
      }
    }

    if (statements.length > 0) {
      await client.batch(statements, 'write');
    }
  }

  async pullAll(userId: string, since: number = 0): Promise<CloudPullResult> {
    const client = this.getClient();

    const [nbRes, secRes, pageRes, elRes] = await Promise.all([
      client.execute({
        sql: `SELECT id, title, created_at, updated_at, "order", deleted_at FROM notebooks WHERE user_id = ? AND updated_at > ?`,
        args: [userId, since],
      }),
      client.execute({
        sql: `SELECT id, notebook_id, title, color, "order", updated_at, deleted_at FROM sections WHERE user_id = ? AND updated_at > ?`,
        args: [userId, since],
      }),
      client.execute({
        sql: `SELECT id, section_id, title, created_at, updated_at, "order", camera, background, deleted_at FROM pages WHERE user_id = ? AND updated_at > ?`,
        args: [userId, since],
      }),
      client.execute({
        sql: `SELECT id, page_id, type, data, updated_at, deleted_at FROM page_elements WHERE user_id = ? AND updated_at > ?`,
        args: [userId, since],
      }),
    ]);

    return {
      notebooks: nbRes.rows.map((r: any) => ({
        id: String(r.id),
        title: String(r.title),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        order: Number(r.order),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      sections: secRes.rows.map((r: any) => ({
        id: String(r.id),
        notebookId: String(r.notebook_id),
        title: String(r.title),
        color: String(r.color),
        order: Number(r.order),
        updatedAt: Number(r.updated_at),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      pages: pageRes.rows.map((r: any) => ({
        id: String(r.id),
        sectionId: String(r.section_id),
        title: String(r.title),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        order: Number(r.order),
        camera: r.camera ? JSON.parse(r.camera) : { x: 0, y: 0, zoom: 1 },
        background: r.background ? JSON.parse(r.background) : { type: 'grid', color: '#ffffff' },
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
      elements: elRes.rows.map((r: any) => ({
        id: String(r.id),
        pageId: String(r.page_id),
        type: r.type as 'stroke' | 'shape' | 'textBlock',
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
        updatedAt: Number(r.updated_at),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      })),
    };
  }

  async deleteItems(userId: string, item: { sectionIds?: string[]; pageIds?: string[] }): Promise<void> {
    const client = this.getClient();
    const now = Date.now();
    const stmts: { sql: string; args: any[] }[] = [];

    if (item.sectionIds && item.sectionIds.length > 0) {
      for (const id of item.sectionIds) {
        stmts.push({
          sql: `UPDATE sections SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          args: [now, now, id, userId],
        });
        stmts.push({
          sql: `UPDATE pages SET deleted_at = ?, updated_at = ? WHERE section_id = ? AND user_id = ?`,
          args: [now, now, id, userId],
        });
      }
    }

    if (item.pageIds && item.pageIds.length > 0) {
      for (const id of item.pageIds) {
        stmts.push({
          sql: `UPDATE pages SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          args: [now, now, id, userId],
        });
      }
    }

    if (stmts.length > 0) {
      await client.batch(stmts, 'write');
    }
  }
}
