// Talking through the phone's own speech synthesis. The synth and the utterance factory are injected so this
// tests without a DOM, the same way wakeLockService.ts sits under useWakeLock.

export interface VoiceLike {
  name: string;
  lang: string;
}

export interface UtteranceLike {
  text: string;
  voice: VoiceLike | null;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface SynthLike {
  getVoices(): VoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  addEventListener?(type: string, listener: () => void): void;
}

// Names the common female voices go by on Android, iOS and Windows
const FEMALE_HINTS = [
  'female', 'tessa', 'samantha', 'karen', 'moira', 'fiona', 'serena', 'zira', 'hazel',
  'susan', 'joanna', 'aria', 'sonia', 'libby', 'michelle', 'catherine', 'amelie',
];

const isFemaleName = (name: string) => {
  const lower = name.toLowerCase();
  return FEMALE_HINTS.some((hint) => lower.includes(hint));
};

// South African English first, then British, then any English. Anything else is left to the browser.
const langRank = (lang: string): number => {
  const lower = (lang || '').toLowerCase();
  if (lower.startsWith('en-za')) return 0;
  if (lower.startsWith('en-gb')) return 1;
  if (lower.startsWith('en')) return 2;
  return 99;
};

export function pickVoice(voices: VoiceLike[]): VoiceLike | null {
  const english = voices.filter((candidate) => langRank(candidate.lang) < 99);
  if (english.length === 0) return null;
  const score = (candidate: VoiceLike) => langRank(candidate.lang) * 2 + (isFemaleName(candidate.name) ? 0 : 1);
  return english.reduce((best, candidate) => (score(candidate) < score(best) ? candidate : best));
}

export class VoiceSpeaker {
  private voice: VoiceLike | null = null;

  constructor(private readonly deps: { synth: SynthLike; createUtterance: (text: string) => UtteranceLike }) {
    this.refreshVoice();
    // getVoices() is often empty on the first call and fills in a moment later
    this.deps.synth.addEventListener?.('voiceschanged', () => this.refreshVoice());
  }

  private refreshVoice(): void {
    this.voice = pickVoice(this.deps.synth.getVoices() ?? []);
  }

  get voiceName(): string | null {
    return this.voice?.name ?? null;
  }

  say(text: string): void {
    const phrase = text.trim();
    if (!phrase) return;
    if (!this.voice) this.refreshVoice();
    // Nothing queues: a stale "in 400 metres" arriving at 80 m is worse than silence
    this.deps.synth.cancel();
    const utterance = this.deps.createUtterance(phrase);
    if (this.voice) {
      utterance.voice = this.voice;
      utterance.lang = this.voice.lang;
    }
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    this.deps.synth.speak(utterance);
  }

  stop(): void {
    this.deps.synth.cancel();
  }
}

export function createBrowserSpeaker(): VoiceSpeaker | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return new VoiceSpeaker({
    synth: window.speechSynthesis as unknown as SynthLike,
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
  });
}
