export interface VideoProbe {
  codec: string;
  format: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export const ROUND_SIDE = 480;
export const ROUND_MAX_SECONDS = 60;

export function parseVideoProbe(json: unknown): VideoProbe {
  const root = (typeof json === 'string' ? safeJson(json) : json) as Record<
    string,
    any
  > | null;
  const streams = (root?.['streams'] ?? []) as Record<string, any>[];
  const video = streams.find((s) => s['codec_type'] === 'video') ?? {};
  const format = (root?.['format'] ?? {}) as Record<string, any>;
  const seconds = Number(video['duration'] ?? format['duration'] ?? 0);
  return {
    codec: String(video['codec_name'] ?? ''),
    format: String(format['format_name'] ?? ''),
    duration: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    width: Number(video['width'] ?? 0) || 0,
    height: Number(video['height'] ?? 0) || 0,
    hasAudio: streams.some((s) => s['codec_type'] === 'audio'),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const roundDuration = (probe: Pick<VideoProbe, 'duration'>): number =>
  Math.max(
    1,
    Math.round(
      Math.min(probe.duration || ROUND_MAX_SECONDS, ROUND_MAX_SECONDS),
    ),
  );

export const isVideoFile = (probe: VideoProbe): boolean =>
  probe.width > 0 && probe.height > 0;

export function roundEncodeArgs(
  source: string,
  target: string,
  probe: VideoProbe,
): string[] {
  const filter = `crop='min(iw,ih)':'min(iw,ih)',scale=${ROUND_SIDE}:${ROUND_SIDE},fps=30,format=yuv420p`;
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    source,
    ...(probe.hasAudio
      ? []
      : [
          '-f',
          'lavfi',
          '-i',
          'anullsrc=channel_layout=mono:sample_rate=44100',
          '-shortest',
        ]),
    '-t',
    String(ROUND_MAX_SECONDS),
    '-map',
    '0:v:0',
    '-map',
    probe.hasAudio ? '0:a:0?' : '1:a:0',
    '-vf',
    filter,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-profile:v',
    'baseline',
    '-level',
    '3.1',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-ac',
    '1',
    '-movflags',
    '+faststart',
    '-map_metadata',
    '-1',
    target,
  ];
}

export const videoProbeArgs = (source: string): string[] => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
  source,
];
