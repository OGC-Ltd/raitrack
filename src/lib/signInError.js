// What the sign-in form says when a sign-in fails.
//
// A rejected email or password is answered with ONE message, whatever the
// reason (unknown address, no password set, wrong password): the server does
// the same so nobody can probe which addresses exist.
//
// Everything else is NOT the credentials, and must not read as if it were. A
// 502 is nginx unable to reach the API at all; showing "Invalid email or
// password" for it sends people to retype a correct password while the server
// is down, and showing "HTTP 502" tells them nothing. The raw message is never
// shown.

const CREDENTIALS = "Invalid email or password.";
const UNREACHABLE = "We can't reach the server right now. Please try again in a minute.";
const TOO_MANY = "Too many sign-in attempts. Please wait a few minutes and try again.";
const OTHER = "Sign-in failed. Please try again.";

/**
 * `{ text, credentials }` for a failed sign-in, or null when there is none.
 * `credentials` says whether the email and password themselves were refused,
 * which is when the form marks those fields invalid.
 */
export function signInError(err) {
  if (!err) return null;
  const status = typeof err.status === "number" ? err.status : null;
  // 400: the address or password failed the server's shape check. Same words
  // as a refusal, so a malformed attempt reveals nothing either.
  if (status === 401 || status === 400) return { text: CREDENTIALS, credentials: true };
  if (status === 429) return { text: TOO_MANY, credentials: false };
  // No status: fetch itself failed (offline, DNS, connection refused).
  if (status === null || status >= 500) return { text: UNREACHABLE, credentials: false };
  return { text: OTHER, credentials: false };
}
