const MEDIA_WORDS_RX =
  /фот|фотк|селфи|сним(и|ись|ешь|ок)|покаж|скин(ь|ешь|уть|ете)|пришл|присыл|отправ(ь|ишь|ите)|голос|войс|аудио|запиш|кружо|кружк|видео|видос|как\s+(ты\s+)?выгляд/i;

export function mentionsMedia(text: string): boolean {
  return MEDIA_WORDS_RX.test(String(text ?? ''));
}
