import {
  isVideoFile,
  parseVideoProbe,
  roundDuration,
  roundEncodeArgs,
  ROUND_MAX_SECONDS,
  ROUND_SIDE,
} from './round-video';

const probe = (over: Partial<ReturnType<typeof parseVideoProbe>> = {}) => ({
  codec: 'h264',
  format: 'mov,mp4',
  duration: 12,
  width: 1920,
  height: 1080,
  hasAudio: true,
  ...over,
});

describe('кружок из видео', () => {
  it('разбор ffprobe: размеры, длительность, есть ли звук', () => {
    const p = parseVideoProbe({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1080,
          height: 1920,
          duration: '8.4',
        },
        { codec_type: 'audio' },
      ],
      format: { format_name: 'mov,mp4,m4a', duration: '8.5' },
    });
    expect(p).toEqual({
      codec: 'h264',
      format: 'mov,mp4,m4a',
      duration: 8.4,
      width: 1080,
      height: 1920,
      hasAudio: true,
    });
    expect(isVideoFile(p)).toBe(true);
    expect(
      isVideoFile(
        parseVideoProbe({ streams: [{ codec_type: 'audio' }], format: {} }),
      ),
    ).toBe(false);
  });

  it('длина кружка — не больше минуты', () => {
    expect(roundDuration({ duration: 12.4 })).toBe(12);
    expect(roundDuration({ duration: 180 })).toBe(ROUND_MAX_SECONDS);
    expect(roundDuration({ duration: 0 })).toBe(ROUND_MAX_SECONDS);
  });

  it('ffmpeg: квадрат по центру, 480×480, минута, h264 + aac и faststart', () => {
    const args = roundEncodeArgs('in.mov', 'out.mp4', probe()).join(' ');
    expect(args).toContain(`scale=${ROUND_SIDE}:${ROUND_SIDE}`);
    expect(args).toContain("crop='min(iw,ih)':'min(iw,ih)'");
    expect(args).toContain(`-t ${ROUND_MAX_SECONDS}`);
    expect(args).toContain('-c:v libx264');
    expect(args).toContain('-movflags +faststart');
    expect(args).not.toContain('anullsrc');
  });

  it('без звука дописывается тишина: кружок без звуковой дорожки Telegram не принимает', () => {
    const args = roundEncodeArgs(
      'in.mp4',
      'out.mp4',
      probe({ hasAudio: false }),
    ).join(' ');
    expect(args).toContain('anullsrc=channel_layout=mono:sample_rate=44100');
    expect(args).toContain('-map 1:a:0');
  });
});
