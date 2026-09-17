import { describe, it, expect, vi } from 'vitest';
import { VoiceSpeaker, pickVoice, type SynthLike, type UtteranceLike, type VoiceLike } from '../src/lib/navigation/voiceSpeaker';

const voice = (name: string, lang: string): VoiceLike => ({ name, lang });

describe('Picking a voice', () => {
  it('prefers a South African English voice', () => {
    const picked = pickVoice([voice('Daniel', 'en-GB'), voice('Tessa', 'en-ZA'), voice('Samantha', 'en-US')]);
    expect(picked?.name).toBe('Tessa');
  });

  it('prefers a female voice within a language', () => {
    const picked = pickVoice([voice('Daniel', 'en-GB'), voice('Google UK English Female', 'en-GB')]);
    expect(picked?.name).toBe('Google UK English Female');
  });

  it('takes a male English voice rather than staying silent', () => {
    expect(pickVoice([voice('Daniel', 'en-GB')])?.name).toBe('Daniel');
  });

  it('leaves the choice to the browser when nothing English is installed', () => {
    expect(pickVoice([voice('Xander', 'nl-NL')])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });
});

function fakeSynth(voices: VoiceLike[] = [voice('Tessa', 'en-ZA')]) {
  const spoken: UtteranceLike[] = [];
  const synth: SynthLike = {
    getVoices: () => voices,
    speak: (utterance) => void spoken.push(utterance),
    cancel: vi.fn(),
  };
  const speaker = new VoiceSpeaker({
    synth,
    createUtterance: (text) => ({ text, voice: null, lang: '', rate: 1, pitch: 1, volume: 1 }),
  });
  return { speaker, spoken, synth };
}

describe('Speaking', () => {
  it('speaks with the chosen voice', () => {
    const { speaker, spoken } = fakeSynth();
    speaker.say('Turn right onto Aden Avenue.');
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('Turn right onto Aden Avenue.');
    expect(spoken[0].voice?.name).toBe('Tessa');
    expect(speaker.voiceName).toBe('Tessa');
  });

  it('cancels whatever is still talking, so a stale turn never lands late', () => {
    const { speaker, spoken, synth } = fakeSynth();
    speaker.say('In 400 metres, turn right onto Aden Avenue.');
    speaker.say('Turn right onto Aden Avenue.');
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(spoken[1].text).toBe('Turn right onto Aden Avenue.');
  });

  it('says nothing when asked to speak an empty phrase', () => {
    const { speaker, spoken } = fakeSynth();
    speaker.say('   ');
    expect(spoken).toEqual([]);
  });

  it('picks a voice later when the device reports none at first', () => {
    let voices: VoiceLike[] = [];
    let onChanged: (() => void) | null = null;
    const spoken: UtteranceLike[] = [];
    const speaker = new VoiceSpeaker({
      synth: {
        getVoices: () => voices,
        speak: (utterance) => void spoken.push(utterance),
        cancel: () => {},
        addEventListener: (_type, listener) => void (onChanged = listener),
      },
      createUtterance: (text) => ({ text, voice: null, lang: '', rate: 1, pitch: 1, volume: 1 }),
    });

    expect(speaker.voiceName).toBeNull();
    voices = [voice('Tessa', 'en-ZA')];
    (onChanged as (() => void) | null)?.();
    speaker.say('Rerouting.');
    expect(spoken[0].voice?.name).toBe('Tessa');
  });

  it('stops listening to the global synth when disposed', () => {
    const added: Array<[string, () => void]> = [];
    const removed: Array<[string, () => void]> = [];
    const speaker = new VoiceSpeaker({
      synth: {
        getVoices: () => [voice('Tessa', 'en-ZA')],
        speak: () => {},
        cancel: () => {},
        addEventListener: (type, listener) => void added.push([type, listener]),
        removeEventListener: (type, listener) => void removed.push([type, listener]),
      },
      createUtterance: (text) => ({ text, voice: null, lang: '', rate: 1, pitch: 1, volume: 1 }),
    });

    expect(added).toHaveLength(1);
    expect(added[0][0]).toBe('voiceschanged');
    speaker.dispose();
    expect(removed).toEqual(added);
  });
});
