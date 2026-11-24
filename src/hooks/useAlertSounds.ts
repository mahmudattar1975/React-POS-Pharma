import { useEffect } from 'react';
import { alertToneFromClass, playAlertSound, primeAlertSounds } from '../utils/alertSound';
import { useSettingsStore } from '../store/settingsStore';

// Every message in the app is an MUI Alert, which renders with role="alert". Watching the DOM once
// here means new success/error/warning/info messages make their cue automatically - pages keep
// using plain <Alert> and don't each need to remember to trigger a sound.
const ALERT_SELECTOR = '[role="alert"]';
// A newly inserted subtree can produce several mutations for the same message. Ignore repeats of
// the same text on the same element so one message is one sound.
const REPEAT_WINDOW_MS = 700;

function classOf(element: Element): string {
  return element.getAttribute('class') ?? '';
}

export function useAlertSounds(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;

    const prime = () => primeAlertSounds();
    window.addEventListener('pointerdown', prime, { once: true, passive: true });
    window.addEventListener('keydown', prime, { once: true });

    const lastPlayed = new WeakMap<Element, { text: string; at: number }>();

    const playFor = (alert: Element) => {
      const tone = alertToneFromClass(classOf(alert));
      if (!tone) return;

      const text = (alert.textContent ?? '').trim();
      const now = Date.now();
      const previous = lastPlayed.get(alert);
      if (previous && previous.text === text && now - previous.at < REPEAT_WINDOW_MS) return;
      lastPlayed.set(alert, { text, at: now });

      if (useSettingsStore.getState().settings.alertSoundsEnabled === false) return;
      playAlertSound(tone);
    };

    const consider = (node: Node) => {
      // Only NEW alert elements speak. An alert that stays mounted and merely refreshes its text
      // (the live change preview in the payment dialog, a running upload counter) would otherwise
      // beep on every keystroke or tick.
      if (!(node instanceof Element)) return;
      if (node.matches(ALERT_SELECTOR)) playFor(node);
      // A dialog or route can mount its whole subtree in one insertion, so the alert itself may be
      // a descendant rather than the inserted node.
      node.querySelectorAll(ALERT_SELECTOR).forEach(playFor);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(consider);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);
}
