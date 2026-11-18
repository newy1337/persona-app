import { crc32, deflateRawSync } from 'zlib';

/** Куда пишем архив: ответ express или любой поток с write/end. */
export interface ZipSink {
  write(chunk: Buffer): unknown;
  end(): unknown;
}

interface Written {
  name: Buffer;
  crc: number;
  size: number;
  packed: number;
  offset: number;
}

/** Время файла в формате DOS: архиваторы показывают его как дату изменения. */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date:
      ((Math.max(d.getFullYear(), 1980) - 1980) << 9) |
      ((d.getMonth() + 1) << 5) |
      d.getDate(),
  };
}

/**
 * ZIP, который пишется по одному файлу: каждый файл сжимается и сразу уходит
 * в поток, в памяти держится только он и короткое оглавление. Имена — UTF-8
 * (флаг 0x0800), так что кириллица открывается и в Windows, и в macOS.
 */
export class ZipStream {
  private offset = 0;
  private readonly files: Written[] = [];
  private readonly stamp = dosTime(new Date());

  constructor(private readonly sink: ZipSink) {}

  private put(chunk: Buffer) {
    this.sink.write(chunk);
    this.offset += chunk.length;
  }

  add(filename: string, content: string | Buffer): void {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflateRawSync(data);
    const name = Buffer.from(filename, 'utf8');
    const file: Written = {
      name,
      crc: crc32(data) >>> 0,
      size: data.length,
      packed: packed.length,
      offset: this.offset,
    };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    header.writeUInt32LE(file.crc, 14);
    header.writeUInt32LE(file.packed, 18);
    header.writeUInt32LE(file.size, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    this.put(header);
    this.put(name);
    this.put(packed);
    this.files.push(file);
  }

  finish(): void {
    const start = this.offset;
    for (const f of this.files) {
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0800, 8);
      entry.writeUInt16LE(8, 10);
      entry.writeUInt16LE(this.stamp.time, 12);
      entry.writeUInt16LE(this.stamp.date, 14);
      entry.writeUInt32LE(f.crc, 16);
      entry.writeUInt32LE(f.packed, 20);
      entry.writeUInt32LE(f.size, 24);
      entry.writeUInt16LE(f.name.length, 28);
      entry.writeUInt32LE(f.offset, 42);
      this.put(entry);
      this.put(f.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.files.length, 8);
    end.writeUInt16LE(this.files.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.put(end);
    this.sink.end();
  }
}
