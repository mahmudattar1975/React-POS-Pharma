// Short, self-contained message tones. The app shows messages with MUI's Alert (role="alert"), and
// this module turns a severity into a small Web Audio cue, so no audio asset files are needed and
// the sound follows the same success / info / warning / error language as the colours.
//
// Browsers suspend audio until the user has interacted with the page, so primeAlertSounds() is
// called from the first pointer/key event. Playing before that simply stays silent instead of
// throwing - a message must never fail because audio is unavailable.
export type AlertTone = 'success' | 'info' | 'warning' | 'error';

// MUI puts the severity in the alert's generated class (standard, filled or outlined variant).
// Kept as a pure helper so the mapping is unit-tested without a DOM or an AudioContext.
const SEVERITY_CLASS = /MuiAlert-(?:standard|filled|outlined)(Success|Error|Warning|Info)/;

export function alertToneFromClass(className: string): AlertTone | null {
  const match = SEVERITY_CLASS.exec(className);
  if (!match) return null;
  switch (match[1]) {
    case 'Success':
      return 'success';
    case 'Error':
      return 'error';
    case 'Warning':
      return 'warning';
    default:
      return 'info';
  }
}

interface ToneNote {
  frequency: number;
  endFrequency?: number;
  type: OscillatorType;
  gain: number;
  duration: number;
  delay?: number;
}

// A rising two-note chime means "done"; a low descending buzz means "failed"; a double mid beep
// warns before the owner walks away; a single soft note is neutral information.
const TONES: Record<AlertTone, ToneNote[]> = {
  success: [
    { frequency: 660, type: 'sine', gain: 0.05, duration: 0.09 },
    { frequency: 880, type: 'sine', gain: 0.05, duration: 0.13, delay: 0.1 },
  ],
  info: [{ frequency: 520, type: 'sine', gain: 0.04, duration: 0.14 }],
  warning: [
    { frequency: 480, type: 'triangle', gain: 0.05, duration: 0.11 },
    { frequency: 480, type: 'triangle', gain: 0.05, duration: 0.11, delay: 0.16 },
  ],
  error: [
    { frequency: 320, endFrequency: 220, type: 'sawtooth', gain: 0.05, duration: 0.3 },
  ],
};

let context: AudioContext | null = null;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function getContext(): AudioContext | null {
  if (context?.state === 'closed') context = null;
  if (!context) {
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

// Call from a real user gesture so the browser allows audio later. Safe to call repeatedly.
export function primeAlertSounds(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

export function playAlertSound(tone: AlertTone): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  if (ctx.state === 'closed') return;

  const now = ctx.currentTime;
  for (const note of TONES[tone]) {
    const start = now + (note.delay ?? 0);
    try {
      const oscillator = ctx.createOscillator();
      const volume = ctx.createGain();
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, start);
      if (note.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, start + note.duration);
      }
      // Quick fade in and out: no click at either end, and the cue stays short enough not to
      // interrupt a conversation at the counter.
      volume.gain.setValueAtTime(0.0001, start);
      volume.gain.exponentialRampToValueAtTime(note.gain, start + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
      oscillator.connect(volume).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + note.duration + 0.02);
    } catch {
      // Audio is a courtesy, never a requirement for the document or stock action.
      return;
    }
  }
}

// Native alert() blocks the page, so play the failure cue first. Used by posting forms whose
// validation errors are raised from the store as exceptions.
export function alertWithSound(message: string): void {
  playAlertSound('error');
  if (typeof window !== 'undefined') window.alert(message);
}
