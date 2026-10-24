export const REACTIONS = [
  '\u{1F44D}',
  '❤',
  '\u{1F601}',
  '\u{1F923}',
  '\u{1F970}',
  '\u{1F622}',
  '\u{1F631}',
  '\u{1F914}',
  '\u{1F525}',
  '\u{1F44F}',
  '\u{1F917}',
  '\u{1F634}',
] as const;

const TELEGRAM_REACTIONS = new Set([
  '\u{1F44D}',
  '\u{1F44E}',
  '❤',
  '\u{1F525}',
  '\u{1F970}',
  '\u{1F44F}',
  '\u{1F601}',
  '\u{1F914}',
  '\u{1F92F}',
  '\u{1F631}',
  '\u{1F92C}',
  '\u{1F622}',
  '\u{1F389}',
  '\u{1F929}',
  '\u{1F92E}',
  '\u{1F4A9}',
  '\u{1F64F}',
  '\u{1F44C}',
  '\u{1F54A}',
  '\u{1F921}',
  '\u{1F971}',
  '\u{1F974}',
  '\u{1F60D}',
  '\u{1F433}',
  '❤‍\u{1F525}',
  '\u{1F31A}',
  '\u{1F32D}',
  '\u{1F4AF}',
  '\u{1F923}',
  '⚡',
  '\u{1F34C}',
  '\u{1F3C6}',
  '\u{1F494}',
  '\u{1F928}',
  '\u{1F610}',
  '\u{1F353}',
  '\u{1F37E}',
  '\u{1F48B}',
  '\u{1F595}',
  '\u{1F608}',
  '\u{1F634}',
  '\u{1F62D}',
  '\u{1F913}',
  '\u{1F47B}',
  '\u{1F468}‍\u{1F4BB}',
  '\u{1F440}',
  '\u{1F383}',
  '\u{1F648}',
  '\u{1F607}',
  '\u{1F628}',
  '\u{1F91D}',
  '✍',
  '\u{1F917}',
  '\u{1FAE1}',
  '\u{1F385}',
  '\u{1F384}',
  '☃',
  '\u{1F485}',
  '\u{1F92A}',
  '\u{1F5FF}',
  '\u{1F192}',
  '\u{1F498}',
  '\u{1F649}',
  '\u{1F984}',
  '\u{1F618}',
  '\u{1F48A}',
  '\u{1F64A}',
  '\u{1F60E}',
  '\u{1F47E}',
  '\u{1F937}‍♂',
  '\u{1F937}',
  '\u{1F937}‍♀',
  '\u{1F621}',
]);

const EMOJI_GROUPS: Record<string, string> = {
  '\u{1F601}':
    '\u{1F600} \u{1F603} \u{1F604} \u{1F601} \u{1F60A} \u{1F642} \u{1F609} \u{1F60C} \u{1F605} \u{1F606}',
  '\u{1F923}': '\u{1F602} \u{1F923}',
  '❤': '❤ \u{1F496} \u{1F497} \u{1F493} \u{1F495} \u{1F49E} \u{1F498} \u{1F49D} \u{1F9E1} \u{1F49B} \u{1F49A} \u{1F499} \u{1F49C} \u{1F90D} \u{1F5A4} \u{1F90E}',
  '\u{1F970}': '\u{1F970} \u{1F60D} \u{1F618} \u{1F61A} \u{1F619} \u{1F617}',
  '\u{1F622}': '\u{1F622} \u{1F62D} \u{1F614} \u{1F61E} \u{1F625} \u{1F97A}',
  '\u{1F631}': '\u{1F631} \u{1F632} \u{1F62E} \u{1F62F} \u{1F92F}',
  '\u{1F914}':
    '\u{1F914} \u{1F928} \u{1F9D0} \u{1F610} \u{1F611} \u{1F615} \u{1F644}',
  '\u{1F44D}': '\u{1F44D} \u{1F44C} \u{1F91D} ✅ \u{1F4AA}',
  '\u{1F44F}': '\u{1F44F} \u{1F64C} \u{1F389} \u{1F973}',
  '\u{1F525}': '\u{1F525} \u{1F4AF}',
  '\u{1F917}': '\u{1F917} \u{1FAC2}',
  '\u{1F634}': '\u{1F634} \u{1F971} \u{1F4A4}',
};

const BY_EMOJI = new Map<string, string>();
for (const [reaction, members] of Object.entries(EMOJI_GROUPS)) {
  for (const emoji of members.split(' ')) BY_EMOJI.set(emoji, reaction);
}

const VARIATION_SELECTOR = '️';

function normalize(emoji: string): string {
  return [...emoji.trim()]
    .filter(
      (char) =>
        char !== VARIATION_SELECTOR &&
        !(char >= '\u{1F3FB}' && char <= '\u{1F3FF}'),
    )
    .join('');
}

export function emojiReaction(emoji: string): string | null {
  const normalized = normalize(emoji);
  if (TELEGRAM_REACTIONS.has(normalized)) return normalized;
  return BY_EMOJI.get(normalized) ?? null;
}
