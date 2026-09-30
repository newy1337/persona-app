export interface AudioProbe {
  codec: string;
  format: string;
  duration: number;
  channels: number;
}

export function parseProbe(json: unknown): AudioProbe {
  const root = (typeof json === 'string' ? safeJson(json) : json) as Record<
    string,
    any
  > | null;
  const stream =
    ((root?.['streams'] ?? []) as Record<string, any>[]).find(
      (s) => s['codec_type'] === 'audio',
    ) ?? {};
  const format = (root?.['format'] ?? {}) as Record<string, any>;
  const seconds = Number(stream['duration'] ?? format['duration'] ?? 0);
  return {
    codec: String(stream['codec_name'] ?? ''),
    format: String(format['format_name'] ?? ''),
    duration: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    channels: Number(stream['channels'] ?? 0) || 0,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function isVoiceReady(probe: AudioProbe): boolean {
  return (
    probe.codec === 'opus' &&
    probe.format.split(',').includes('ogg') &&
    probe.channels === 1
  );
}

export function encodeArgs(source: string, target: string): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    source,
    '-vn',
    '-map_metadata',
    '-1',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-c:a',
    'libopus',
    '-b:a',
    '32k',
    '-application',
    'voip',
    '-f',
    'ogg',
    target,
  ];
}

export const probeArgs = (source: string): string[] => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
  source,
];
