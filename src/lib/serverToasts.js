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

export function receiveServerToast(toast) {
  if (!addToast(toast)) return;
  if (toast.kind === 'stop') {
    beep();
    notify(`Menengai: ${toast.title.toLowerCase()}`, toast.body);
  }
}
