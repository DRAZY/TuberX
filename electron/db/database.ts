import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryEntry, LaterEntry, QueueRow, Subscription } from '../../shared/types'

/**
 * One SQLite file under userData, through Node's built-in `node:sqlite` (Electron 38 / Node 22.22)
 * so there is no native module to rebuild per platform. Queue rows persist so an unexpected
 * quit brings the list back; history and later are the two side lists.
 */
export class TuberDb {
  private db: DatabaseSync

  constructor(file = join(app.getPath('userData'), 'tuberx.db')) {
    mkdirSync(join(file, '..'), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        format_id TEXT,
        destination TEXT NOT NULL,
        media_json TEXT,
        output_path TEXT,
        error TEXT,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        url_key TEXT NOT NULL,
        title TEXT NOT NULL,
        format_id TEXT NOT NULL,
        output_path TEXT NOT NULL,
        thumbnail TEXT,
        completed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_url_key ON history(url_key);
      CREATE TABLE IF NOT EXISTS later (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        url_key TEXT NOT NULL UNIQUE,
        title TEXT,
        thumbnail TEXT,
        duration REAL,
        added_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        url_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        thumbnail TEXT,
        added_at INTEGER NOT NULL,
        last_checked INTEGER,
        total INTEGER NOT NULL DEFAULT 0,
        known TEXT NOT NULL DEFAULT '[]',
        fresh TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS destinations (
        path TEXT PRIMARY KEY,
        last_used INTEGER NOT NULL
      );
    `)
    // Additive column migrations: check first, then add, and never swallow a real failure
    // (a missing column surfaces on the first write as an opaque "SQL logic error").
    const columns = new Set((this.db.prepare('PRAGMA table_info(queue)').all() as { name: string }[]).map((c) => c.name))
    if (!columns.has('downloaded_variants')) this.db.exec('ALTER TABLE queue ADD COLUMN downloaded_variants TEXT')
  }

  /** Run one statement per value inside a single transaction. */
  private each(sql: string, values: string[]) {
    if (!values.length) return
    const stmt = this.db.prepare(sql)
    this.db.exec('BEGIN')
    try {
      for (const v of values) stmt.run(v)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }

  }

  // ---- queue ----
  loadQueue(): QueueRow[] {
    const rows = this.db.prepare('SELECT * FROM queue ORDER BY position, added_at').all() as any[]
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      addedAt: r.added_at,
      // anything that was mid-flight when we died comes back as ready (or fetching → re-fetch)
      status: r.status === 'downloading' || r.status === 'converting' || r.status === 'queued' ? 'ready' : r.status,
      formatId: r.format_id ?? undefined,
      destination: r.destination,
      media: r.media_json ? JSON.parse(r.media_json) : undefined,
      outputPath: r.output_path ?? undefined,
      error: r.error ?? undefined,
      downloadedVariants: r.downloaded_variants ? JSON.parse(r.downloaded_variants) : undefined,
    }))
  }

  saveRow(row: QueueRow, position: number) {
    this.db
      .prepare(
        `INSERT INTO queue (id,url,added_at,status,format_id,destination,media_json,output_path,error,position,downloaded_variants)
         VALUES (@id,@url,@added_at,@status,@format_id,@destination,@media_json,@output_path,@error,@position,@downloaded_variants)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, format_id=excluded.format_id, destination=excluded.destination,
           media_json=excluded.media_json, output_path=excluded.output_path, error=excluded.error, position=excluded.position,
           downloaded_variants=excluded.downloaded_variants`,
      )
      .run({
        id: row.id,
        url: row.url,
        added_at: row.addedAt,
        status: row.status,
        format_id: row.formatId ?? null,
        destination: row.destination,
        media_json: row.media ? JSON.stringify(row.media) : null,
        output_path: row.outputPath ?? null,
        error: row.error ?? null,
        position,
        downloaded_variants: row.downloadedVariants ? JSON.stringify(row.downloadedVariants) : null,
      })
  }

  deleteRows(ids: string[]) {
    this.each('DELETE FROM queue WHERE id = ?', ids)
  }

  // ---- history ----
  listHistory(): HistoryEntry[] {
    const rows = this.db.prepare('SELECT * FROM history ORDER BY completed_at DESC').all() as any[]
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      formatId: r.format_id,
      outputPath: r.output_path,
      thumbnail: r.thumbnail ?? undefined,
      completedAt: r.completed_at,
    }))
  }
  addHistory(e: HistoryEntry, urlKey: string) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO history (id,url,url_key,title,format_id,output_path,thumbnail,completed_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(e.id, e.url, urlKey, e.title, e.formatId, e.outputPath, e.thumbnail ?? null, e.completedAt)
  }
  historyHas(urlKey: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM history WHERE url_key = ? LIMIT 1').get(urlKey)
  }
  /** Every file this link has produced, newest first: the record of what the user already has on disk. */
  historyFor(urlKey: string): { formatId: string; outputPath: string }[] {
    return this.db
      .prepare('SELECT format_id AS formatId, output_path AS outputPath FROM history WHERE url_key = ? ORDER BY completed_at DESC')
      .all(urlKey) as { formatId: string; outputPath: string }[]
  }
  replaceHistoryPath(from: string, to: string) {
    this.db.prepare('UPDATE history SET output_path = ? WHERE output_path = ?').run(to, from)
  }
  removeHistory(ids: string[]) {
    this.each('DELETE FROM history WHERE id = ?', ids)
  }
  clearHistory() {
    this.db.prepare('DELETE FROM history').run()
  }

  // ---- subscriptions ----
  listSubs(): Subscription[] {
    const rows = this.db.prepare('SELECT * FROM subscriptions ORDER BY added_at DESC').all() as any[]
    return rows.map((r) => ({
      id: r.id, url: r.url, title: r.title, thumbnail: r.thumbnail ?? undefined, addedAt: r.added_at,
      lastChecked: r.last_checked ?? undefined, total: r.total, newUrls: JSON.parse(r.fresh),
    }))
  }
  subKnown(id: string): string[] {
    const r = this.db.prepare('SELECT known FROM subscriptions WHERE id = ?').get(id) as { known: string } | undefined
    return r ? JSON.parse(r.known) : []
  }
  addSub(s: Subscription, urlKey: string, known: string[]): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO subscriptions (id,url,url_key,title,thumbnail,added_at,last_checked,total,known,fresh) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(s.id, s.url, urlKey, s.title, s.thumbnail ?? null, s.addedAt, s.lastChecked ?? null, s.total, JSON.stringify(known), JSON.stringify(s.newUrls))
    return res.changes > 0
  }
  updateSub(id: string, patch: { title?: string; thumbnail?: string; lastChecked?: number; total?: number; known?: string[]; fresh?: string[] }) {
    this.db
      .prepare(
        `UPDATE subscriptions SET title = COALESCE(?, title), thumbnail = COALESCE(?, thumbnail), last_checked = COALESCE(?, last_checked),
         total = COALESCE(?, total), known = COALESCE(?, known), fresh = COALESCE(?, fresh) WHERE id = ?`,
      )
      .run(patch.title ?? null, patch.thumbnail ?? null, patch.lastChecked ?? null, patch.total ?? null, patch.known ? JSON.stringify(patch.known) : null, patch.fresh ? JSON.stringify(patch.fresh) : null, id)
  }
  removeSubs(ids: string[]) {
    this.each('DELETE FROM subscriptions WHERE id = ?', ids)
  }

  // ---- later ----
  listLater(): LaterEntry[] {
    const rows = this.db.prepare('SELECT * FROM later ORDER BY added_at DESC').all() as any[]
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title ?? undefined,
      thumbnail: r.thumbnail ?? undefined,
      duration: r.duration ?? undefined,
      addedAt: r.added_at,
    }))
  }
  laterHas(urlKey: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM later WHERE url_key = ? LIMIT 1').get(urlKey)
  }
  addLater(e: LaterEntry, urlKey: string): boolean {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO later (id,url,url_key,title,thumbnail,duration,added_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(e.id, e.url, urlKey, e.title ?? null, e.thumbnail ?? null, e.duration ?? null, e.addedAt)
    return Number(r.changes) > 0
  }
  updateLater(id: string, patch: Partial<LaterEntry>) {
    this.db
      .prepare('UPDATE later SET title = COALESCE(?, title), thumbnail = COALESCE(?, thumbnail), duration = COALESCE(?, duration) WHERE id = ?')
      .run(patch.title ?? null, patch.thumbnail ?? null, patch.duration ?? null, id)
  }
  removeLater(ids: string[]) {
    this.each('DELETE FROM later WHERE id = ?', ids)
  }
  getLater(ids: string[]): LaterEntry[] {
    return this.listLater().filter((e) => ids.includes(e.id))
  }

  // ---- destinations ----
  touchDestination(path: string, keep = 15) {
    this.db.prepare('INSERT OR REPLACE INTO destinations (path,last_used) VALUES (?,?)').run(path, Date.now())
    this.db
      .prepare('DELETE FROM destinations WHERE path NOT IN (SELECT path FROM destinations ORDER BY last_used DESC LIMIT ?)')
      .run(keep)
  }
  listDestinations(): string[] {
    return (this.db.prepare('SELECT path FROM destinations ORDER BY last_used DESC').all() as any[]).map((r) => r.path)
  }

  close() {
    this.db.close()
  }
}
