import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryEntry, LaterEntry, QueueRow } from '../../shared/types'

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
      CREATE TABLE IF NOT EXISTS destinations (
        path TEXT PRIMARY KEY,
        last_used INTEGER NOT NULL
      );
    `)
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
    }))
  }

  saveRow(row: QueueRow, position: number) {
    this.db
      .prepare(
        `INSERT INTO queue (id,url,added_at,status,format_id,destination,media_json,output_path,error,position)
         VALUES (@id,@url,@added_at,@status,@format_id,@destination,@media_json,@output_path,@error,@position)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, format_id=excluded.format_id, destination=excluded.destination,
           media_json=excluded.media_json, output_path=excluded.output_path, error=excluded.error, position=excluded.position`,
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
  removeHistory(ids: string[]) {
    this.each('DELETE FROM history WHERE id = ?', ids)
  }
  clearHistory() {
    this.db.prepare('DELETE FROM history').run()
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
