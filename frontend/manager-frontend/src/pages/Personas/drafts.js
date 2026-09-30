const KEY = (personaId, section) => `nastya_persona_draft_${personaId}_${section}`;

export const drafts = {
  read(personaId, section) {
    try {
      const raw = window.localStorage.getItem(KEY(personaId, section));
      if (!raw) return null;
      const d = JSON.parse(raw);
      return typeof d?.text === 'string' ? { text: d.text, savedAt: Number(d.savedAt) || Date.now() } : null;
    } catch {
      return null;
    }
  },
  write(personaId, section, text) {
    try {
      window.localStorage.setItem(KEY(personaId, section), JSON.stringify({ text, savedAt: Date.now() }));
    } catch {
    }
  },
  clear(personaId, section) {
    try {
      window.localStorage.removeItem(KEY(personaId, section));
    } catch {
    }
  },
  sectionsOf(personaId, sections) {
    return sections.filter((section) => drafts.read(personaId, section) !== null);
  },
};
