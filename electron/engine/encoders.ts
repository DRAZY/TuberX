import { spawn } from 'node:child_process'
import { resolveTool } from './paths'

export type Codec = 'h264' | 'h265'
export interface EncoderChoice {
  /** ffmpeg encoder name, e.g. h264_videotoolbox, hevc_nvenc, libx264 */
  encoder: string
  /** Human label for the settings panel */
  label: string
  hardware: boolean
}

// Candidates in preference order per platform; each is proven by a real one-frame encode, because
// ffmpeg lists every encoder it was built with whether or not the machine has the GPU for it.
const CANDIDATES: Record<Codec, { encoder: string; label: string; hardware: boolean; platforms?: NodeJS.Platform[] }[]> = {
  h264: [
    { encoder: 'h264_videotoolbox', label: 'Apple VideoToolbox', hardware: true, platforms: ['darwin'] },
    { encoder: 'h264_nvenc', label: 'NVIDIA NVENC', hardware: true, platforms: ['win32', 'linux'] },
    { encoder: 'h264_qsv', label: 'Intel Quick Sync', hardware: true, platforms: ['win32', 'linux'] },
    { encoder: 'h264_amf', label: 'AMD AMF', hardware: true, platforms: ['win32'] },
    { encoder: 'libx264', label: 'software (x264)', hardware: false },
  ],
  h265: [
    { encoder: 'hevc_videotoolbox', label: 'Apple VideoToolbox', hardware: true, platforms: ['darwin'] },
    { encoder: 'hevc_nvenc', label: 'NVIDIA NVENC', hardware: true, platforms: ['win32', 'linux'] },
    { encoder: 'hevc_qsv', label: 'Intel Quick Sync', hardware: true, platforms: ['win32', 'linux'] },
    { encoder: 'hevc_amf', label: 'AMD AMF', hardware: true, platforms: ['win32'] },
    { encoder: 'libx265', label: 'software (x265)', hardware: false },
  ],
}

const cache = new Map<Codec, Promise<EncoderChoice | null>>()

/** The best encoder that actually works on this machine for the codec, probed once per app run. */
export function bestEncoder(codec: Codec): Promise<EncoderChoice | null> {
  let p = cache.get(codec)
  if (!p) {
    p = (async () => {
      for (const c of CANDIDATES[codec]) {
        if (c.platforms && !c.platforms.includes(process.platform)) continue
        if (await probe(c.encoder)) return { encoder: c.encoder, label: c.label, hardware: c.hardware }
      }
      return null
    })()
    cache.set(codec, p)
  }
  return p
}

/** Encode eight synthetic frames; exit 0 means the encoder initialised on real hardware. */
function probe(encoder: string): Promise<boolean> {
  const ffmpeg = resolveTool('ffmpeg')
  if (!ffmpeg) return Promise.resolve(false)
  return new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=8:d=1', '-frames:v', '8', '-c:v', encoder, '-f', 'null', '-'],
      { windowsHide: true, stdio: 'ignore' },
    )
    const t = setTimeout(() => {
      child.kill()
      resolve(false)
    }, 15000)
    child.on('error', () => {
      clearTimeout(t)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(t)
      resolve(code === 0)
    })
  })
}

/** Encoder flags tuned for "same visual quality as the source, fast": a bitrate matched to the source for hardware, CRF for software. */
export function encoderArgs(choice: EncoderChoice, sourceKbps: number | undefined): string[] {
  // HEVC needs roughly two thirds of the H.264 bitrate for the same picture; that is where its smaller files come from.
  const factor = /hevc|x265/.test(choice.encoder) ? 0.65 : 1
  const kbps = Math.max(400, Math.round((sourceKbps ?? 4000) * factor))
  switch (choice.encoder) {
    case 'h264_videotoolbox':
    case 'hevc_videotoolbox':
      return ['-c:v', choice.encoder, '-b:v', `${kbps}k`, '-allow_sw', '1', ...(choice.encoder === 'hevc_videotoolbox' ? ['-tag:v', 'hvc1'] : [])]
    case 'h264_nvenc':
    case 'hevc_nvenc':
      return ['-c:v', choice.encoder, '-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-b:v', `${kbps}k`, '-maxrate', `${kbps * 2}k`, ...(choice.encoder === 'hevc_nvenc' ? ['-tag:v', 'hvc1'] : [])]
    case 'h264_qsv':
    case 'hevc_qsv':
      return ['-c:v', choice.encoder, '-global_quality', '23', '-b:v', `${kbps}k`, ...(choice.encoder === 'hevc_qsv' ? ['-tag:v', 'hvc1'] : [])]
    case 'h264_amf':
    case 'hevc_amf':
      return ['-c:v', choice.encoder, '-quality', 'quality', '-rc', 'vbr_peak', '-b:v', `${kbps}k`, ...(choice.encoder === 'hevc_amf' ? ['-tag:v', 'hvc1'] : [])]
    case 'libx265':
      return ['-c:v', 'libx265', '-preset', 'medium', '-crf', '24', '-tag:v', 'hvc1']
    default:
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20']
  }
}
