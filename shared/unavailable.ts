/**
 * Videos that are gone for good: private, deleted, removed by the uploader, the account terminated, taken
 * down for copyright or the site's rules, or a 404/410 from another site. No retry, login or engine update
 * brings these back, so the queue can offer to clear them in one go (#17).
 *
 * Deliberately NOT here: geo-blocks, members-only, age checks and YouTube's sign-in check (a login or a
 * different network fixes those), and "This content isn't available, try again later", which is YouTube
 * rate-limiting a busy client rather than a dead video.
 */
const GONE =
  /\bprivate video\b|this video is private|removed by the uploader|account associated with this video has been terminated|copyright (claim|grounds)|violat\w* (YouTube's |the )?(Terms|Community Guidelines)|video has been removed|video (is|has been) (deleted|no longer available)|\[deleted video\]|\bvideo unavailable\b|\bvideo is unavailable\b|HTTP Error 4(04|10)\b/i
const FIXABLE = /country|geo-?(block|restrict)|try again later|content isn['’]t available|members[- ]only|join this channel|age[- ]?(restrict|gate|verif)|confirm you['’]re not a bot|sign in to confirm/i

/** Whether a failure message (yt-dlp's own text is kept inside the app's wording) means the video is gone. */
export function isUnavailableError(message: string): boolean {
  return GONE.test(message) && !FIXABLE.test(message)
}

/**
 * Whether a playlist entry is a placeholder for a video that can no longer be watched. YouTube lists those
 * as "[Private video]" or "[Deleted video]" (yt-dlp asks YouTube for English, so the titles are English);
 * some extractors set `availability: 'private'` instead. Terminated and copyright-blocked videos are usually
 * left out of the listing altogether, so they only show up later, as failed rows.
 */
export function isUnavailableEntry(title: string | undefined, availability?: string): boolean {
  return availability === 'private' || /^\[(private|deleted) video\]$/i.test((title ?? '').trim())
}
