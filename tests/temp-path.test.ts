import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempPathArgs } from '../electron/engine/tempArgs'

describe('yt-dlp temp path (issue #14)', () => {
  test('points at the app-data tmp folder, never the working folder', () => {
    expect(tempPathArgs('/data')).toEqual(['-P', `temp:${join('/data', 'tmp')}`])
  })

  test('the arguments shared by every yt-dlp run include it', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'electron', 'engine', 'ytdlp.ts'), 'utf8')
    const common = source.slice(source.indexOf('function commonArgs('), source.indexOf('export function engineEnv'))
    expect(common).toContain("tempPathArgs(app.getPath('userData'))")
  })
})
