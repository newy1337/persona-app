import { isVideo } from './photo-sets.service';

const box = (brand: string) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftyp' + brand, 'latin1'),
    Buffer.alloc(8),
  ]);

describe('видео для кружка в библиотеке', () => {
  it('по расширению', () => {
    expect(isVideo('note.MP4', Buffer.alloc(0))).toBe(true);
    expect(isVideo('clip.mov', Buffer.alloc(0))).toBe(true);
    expect(isVideo('photo.jpg', Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
  });
  it('по сигнатуре: MP4 и WebM — видео, HEIC/AVIF — снимок', () => {
    expect(isVideo('file', box('isom'))).toBe(true);
    expect(isVideo('file', box('qt  '))).toBe(true);
    expect(isVideo('file', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe(
      true,
    );
    expect(isVideo('file', box('heic'))).toBe(false);
    expect(isVideo('file', box('avif'))).toBe(false);
  });
});
