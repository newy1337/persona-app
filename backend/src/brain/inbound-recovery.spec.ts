import { restoredTurn } from './inbound-recovery';
it('restores a photo from a paused message saved without a payload, without losing the file', () => {
  const turn = restoredTurn(
    {
      chat_id: 1,
      source_message_id: 5,
      ts: 100,
      text: '[Фото]\nКак тебе?',
      media_kind: 'photo',
      file_path: '/synthetic/photo.jpg',
    } as any,
    2,
  );
  expect(turn.media).toEqual({ kind: 'photo', path: '/synthetic/photo.jpg' });
  expect(turn.text).toBe('Как тебе?');
  expect(turn.replay).toBe(true);
});
it('restores duration and transcript without another transcription or duplicated labels', () => {
  const payload = {
    text: '',
    media: {
      kind: 'voice',
      path: '/voice.ogg',
      transcript: 'Я в Мадриде',
      duration: 12,
    },
  };
  const turn = restoredTurn(
    {
      chat_id: 1,
      source_message_id: 5,
      ts: 100,
      text: '[Голосовое]\nЯ в Мадриде',
      inbound_payload: JSON.stringify(payload),
    } as any,
    2,
  );
  expect(turn.media).toEqual(payload.media);
  expect(turn.text).toBe('');
});
