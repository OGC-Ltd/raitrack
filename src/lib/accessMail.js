/**
 * What happened to an invitation or reset mail, as one line for the toast.
 *
 * The server sends account mail inline now (2026-10-28), so `sent` means the
 * provider took it. `queued` only follows a refusal and carries why and when
 * it tries again — the screen used to say "queued for delivery" for an hour
 * with no reason, which was no answer at all.
 *
 * `state` is sent | pending | failed. Pending is not failure: the retry is
 * automatic and there is nothing to do but know when.
 */

const FAILED_WHY = {
  unconfigured: "email is not configured on the server",
  "send-failed": "the mail server rejected it",
  "not-allowed": "the server does not allow this mail",
  "no-email": "the account has no email address",
  "account-already-active": "that account already has a password",
  "recently-sent": "one was sent less than a minute ago",
  "not-requested": "no invitation was requested",
};

/** "14:05", or "14:05 tomorrow" when the retry falls on another day. */
export function retryClock(iso, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const clock = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === now.toDateString() ? clock : `${clock} tomorrow`;
}

/**
 * @param {{ sent?: boolean, reason?: string, because?: string, retryAt?: string } | null | undefined} mail
 * @param {string} what   "Invitation" | "Reset link"
 * @param {string} to     the address
 */
export function accessMailNote(mail, what, to, now = new Date()) {
  if (mail?.sent) return { state: "sent", text: `${what} emailed to ${to}.` };

  if (mail?.reason === "queued") {
    const at = mail.retryAt ? retryClock(mail.retryAt, now) : null;
    const when = at ? `It goes out automatically at ${at}.` : "It will be retried automatically.";
    if (mail.because === "provider-quota") {
      return { state: "pending", text: `Not sent yet, the mail service's daily limit is reached. ${when}` };
    }
    if (mail.because === "send-failed") {
      return { state: "pending", text: `Not sent yet, the mail server did not accept it. ${when}` };
    }
    // An older server that queues first and says nothing more.
    return { state: "pending", text: `${what} to ${to} is waiting to be sent.` };
  }

  const why = FAILED_WHY[mail?.reason] ?? mail?.reason ?? "reason not reported";
  return { state: "failed", text: `${what} not sent, ${why}.` };
}
