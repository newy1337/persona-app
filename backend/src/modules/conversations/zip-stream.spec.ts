import { crc32, inflateRawSync } from 'zlib';
import { ZipStream } from './zip-stream';

/** Разобрать архив по оглавлению, как это делает архиватор. */
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const packed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26);
    const data = inflateRawSync(buf.subarray(dataAt, dataAt + packed));
    expect(crc32(data) >>> 0).toBe(crc);
    out.set(name, data.toString('utf8'));
    p += 46 + nameLen;
  }
  return out;
}

describe('ZIP по одному файлу', () => {
  it('файлы с кириллицей в именах читаются обратно целиком', () => {
    const chunks: Buffer[] = [];
    let ended = false;
    const zip = new ZipStream({
      write: (c: Buffer) => chunks.push(c),
      end: () => (ended = true),
    });
    zip.add('001_Олег_777.html', '<p>привет</p>'.repeat(1000));
    zip.add('002_chat_5_ошибка.txt', 'Диалог 5 не выгружен');
    zip.finish();
    expect(ended).toBe(true);
    const files = unzip(Buffer.concat(chunks));
    expect([...files.keys()]).toEqual([
      '001_Олег_777.html',
      '002_chat_5_ошибка.txt',
    ]);
    expect(files.get('001_Олег_777.html')).toBe('<p>привет</p>'.repeat(1000));
    expect(files.get('002_chat_5_ошибка.txt')).toBe('Диалог 5 не выгружен');
  });

  it('пустой архив — только оглавление', () => {
    const chunks: Buffer[] = [];
    const zip = new ZipStream({
      write: (c: Buffer) => chunks.push(c),
      end: () => 0,
    });
    zip.finish();
    expect(unzip(Buffer.concat(chunks)).size).toBe(0);
  });
});
