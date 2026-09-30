import { encodeArgs, isVoiceReady, parseProbe, probeArgs } from './voice-file';

describe('голосовое для Telegram', () => {
  const probe = (streams: unknown[], format: Record<string, unknown>) =>
    parseProbe({ streams, format });

  it('диктофон браузера и mp3 — перекодировать, готовый ogg/opus моно — нет', () => {
    const opus = probe(
      [
        {
          codec_type: 'audio',
          codec_name: 'opus',
          channels: 1,
          duration: '3.2',
        },
      ],
      { format_name: 'ogg', duration: '3.2' },
    );
    expect(isVoiceReady(opus)).toBe(true);
    expect(opus.duration).toBeCloseTo(3.2, 1);

    expect(
      isVoiceReady(
        probe([{ codec_type: 'audio', codec_name: 'mp3', channels: 2 }], {
          format_name: 'mp3',
        }),
      ),
    ).toBe(false);
    expect(
      isVoiceReady(
        probe([{ codec_type: 'audio', codec_name: 'opus', channels: 2 }], {
          format_name: 'ogg',
        }),
      ),
    ).toBe(false);
    expect(
      isVoiceReady(
        probe([{ codec_type: 'audio', codec_name: 'opus', channels: 1 }], {
          format_name: 'matroska,webm',
        }),
      ),
    ).toBe(false);
  });

  it('видеодорожка и обложка не мешают: длительность берётся у звука', () => {
    const p = probe(
      [
        { codec_type: 'video', codec_name: 'mjpeg' },
        {
          codec_type: 'audio',
          codec_name: 'aac',
          channels: 2,
          duration: '12.5',
        },
      ],
      { format_name: 'mov,mp4,m4a', duration: '12.5' },
    );
    expect(p.codec).toBe('aac');
    expect(p.duration).toBeCloseTo(12.5, 1);
    expect(isVoiceReady(p)).toBe(false);
  });

  it('мусор вместо ответа ffprobe — нули, а не падение', () => {
    expect(parseProbe('не json')).toEqual({
      codec: '',
      format: '',
      duration: 0,
      channels: 0,
    });
    expect(parseProbe(null)).toEqual({
      codec: '',
      format: '',
      duration: 0,
      channels: 0,
    });
  });

  it('команда перекодировки: моно opus в ogg, без видео', () => {
    const args = encodeArgs('in.mp3', 'out.ogg').join(' ');
    expect(args).toContain('-c:a libopus');
    expect(args).toContain('-ac 1');
    expect(args).toContain('-vn');
    expect(args).toContain('-f ogg out.ogg');
    expect(probeArgs('in.mp3')).toContain('-show_streams');
  });
});
