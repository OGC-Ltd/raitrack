import { describe, it, expect } from "vitest";
import { signInError } from "./signInError";
import { ApiError } from "../services/api";

describe("what a failed sign-in says", () => {
  it("says nothing when nothing failed", () => {
    expect(signInError(null)).toBeNull();
  });

  it("answers a refused email or password with the one generic message, on the fields", () => {
    expect(signInError(new ApiError("Invalid credentials", 401))).toEqual({ text: "Invalid email or password.", credentials: true });
    expect(signInError(new ApiError("Validation failed - email: Invalid email", 400)).text).toBe("Invalid email or password.");
  });

  it("never shows a raw HTTP status: a 502 says the server is unreachable, not the credentials", () => {
    for (const status of [500, 502, 503, 504]) {
      const out = signInError(new ApiError(`HTTP ${status}`, status));
      expect(out.text).not.toMatch(/HTTP/);
      expect(out.text).toMatch(/can't reach the server/);
      expect(out.credentials).toBe(false);
    }
  });

  it("treats a request that never got an answer as unreachable", () => {
    expect(signInError(new TypeError("Failed to fetch")).text).toMatch(/can't reach the server/);
  });

  it("asks a rate-limited caller to wait", () => {
    expect(signInError(new ApiError("Too many requests, please try again later", 429)))
      .toEqual({ text: expect.stringMatching(/Too many sign-in attempts/), credentials: false });
  });

  it("falls back to a plain message for anything else", () => {
    expect(signInError(new ApiError("Account suspended", 403)).text).toBe("Sign-in failed. Please try again.");
  });
});
