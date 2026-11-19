// A toast frame from the server (hooks/useFleetLive): queued for the stack
// (lib/toasts), and for a stop-watch flag the sound and the desktop alert the
// stop pop-ups always had. Web pushes need neither: the service worker shows
// those on the desktop itself.

import { addToast } from './toasts';
import { desktopAlertsOn } from './stopWatch';

let audio = null;
function beep() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.6);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.65);
  } catch { /* no sound in this browser */ }
}

function notify(title, body) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && desktopAlertsOn()) {
      new Notification(title, { body, tag: body });
    }
  } catch { /* not allowed here */ }
}

/** West Kenya's three organisations are one fleet to the people who watch it. */
const FAMILY = { WESTSUGAR: 'WEST KENYA', KABRAS: 'WEST KENYA', NZOIA: 'WEST KENYA' };
const familyOf = (code) => FAMILY[String(code ?? '').toUpperCase()] ?? String(code ?? '').toUpperCase();
const FAMILY_NAME = { MENENGAI: 'Menengai', 'WEST KENYA': 'West Kenya' };

/**
 * Whether a server toast shows in the company open (operator, 2026-11-19:
 * Menengai's stop pop-ups only in Menengai, West Kenya's only in West Kenya).
 * Stop alerts only: they carry their organisation (`data.orgCode`); every
 * other toast shows as before. Without either code there is nothing to judge.
 */
export function belongsHere(toast, activeOrgCode) {
  if (toast?.kind !== 'stop') return true;
  const from = toast.data?.orgCode;
  if (!from || !activeOrgCode) return true;
  return familyOf(from) === familyOf(activeOrgCode);
}

/** "Menengai: unauthorised stop", "West Kenya: unauthorised stop": the desktop alert's title. */
export const stopNoticeTitle = (toast) => {
  const name = FAMILY_NAME[familyOf(toast?.data?.orgCode)];
  const what = String(toast?.title ?? 'Stop').toLowerCase();
  return name ? `${name}: ${what}` : toast?.title ?? 'Stop';
};

/** @param {string|null} activeOrgCode  the open company's organisation code (api/org ORG_CODE_BY_COMPANY) */
export function receiveServerToast(toast, activeOrgCode = null) {
  if (!belongsHere(toast, activeOrgCode)) return;
  if (!addToast(toast)) return;
  if (toast.kind === 'stop') {
    beep();
    notify(stopNoticeTitle(toast), toast.body);
  }
}
