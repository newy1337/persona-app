import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CallRecorder,
  defaultCallTitle,
  mergeArgs,
} from './voicer-call-recording.service';

describe('диктофон звонка', () => {
  it('ffmpeg получает два моно PCM и отдаёт стерео opus, войсер слева', () => {
    const args = mergeArgs('/a/mic.raw', '/a/peer.raw', '/a/out.ogg');
    expect(args.indexOf('/a/mic.raw')).toBeLessThan(
      args.indexOf('/a/peer.raw'),
    );
    expect(args.join(' ')).toContain('-f s16le -ar 48000 -ac 1 -i /a/mic.raw');
    expect(args.join(' ')).toContain('amerge=inputs=2');
    expect(args.join(' ')).toContain('-c:a libopus');
    expect(args[args.length - 1]).toBe('/a/out.ogg');
  });

  it('подпись по умолчанию — задание и время звонка по Москве', () => {
    expect(defaultCallTitle('Утро для Димы', 1_760_000_000)).toMatch(
      /^Утро для Димы · звонок \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} МСК$/,
    );
  });

  it('кадры обеих сторон попадают в свои файлы, после закрытия не пишутся', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'call-rec-'));
    const rec = new CallRecorder(join(dir, 'mic.raw'), join(dir, 'peer.raw'));
    rec.fromVoicer(Buffer.from([1, 2, 3, 4]));
    rec.fromPeer(Buffer.from([9, 9]));
    await rec.close();
    rec.fromVoicer(Buffer.from([5, 5]));
    expect([...(await readFile(join(dir, 'mic.raw')))]).toEqual([1, 2, 3, 4]);
    expect([...(await readFile(join(dir, 'peer.raw')))]).toEqual([9, 9]);
    await rm(dir, { recursive: true, force: true });
  });
});
