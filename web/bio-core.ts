/** Wording and decisions for unlocking with fingerprint or face (pure, unit tested). */
export type BioKind = "fingerprint" | "face" | "both";
export type BioInfo = { available: boolean; reason?: string; kind?: BioKind };

export function bioNoun(kind: BioKind | undefined): string {
  return kind === "face" ? "face" : kind === "both" ? "fingerprint or face" : "fingerprint";
}
export const bioAction = (kind: BioKind | undefined): string => `Unlock with ${bioNoun(kind)}`;

/** Why the option is not offered, in plain words, or null when it can be offered. */
export function bioUnavailableText(info: BioInfo): string | null {
  if (info.available) return null;
  if (info.reason === "none-enrolled") return "Add a fingerprint or face in Android Settings > Security, then come back here to turn this on.";
  if (info.reason === "busy") return "The sensor is not available right now. Try again in a moment.";
  return "This phone has no fingerprint or face sensor that meets Android's strong security level, so PrivateBit uses your password only.";
}

/** Plain message for a native error code, or null when nothing should be said (you cancelled). */
export function bioErrorText(code: string | undefined, kind: BioKind | undefined): string | null {
  switch (code) {
    case "cancelled":
      return null;
    case "tries":
    case "lockout":
      return "Too many tries. Unlock with your password.";
    case "restart":
      return "Your phone restarted. Unlock with your password once.";
    case "changed":
      return `The ${bioNoun(kind)} settings on this phone changed, so ${bioNoun(kind)} unlock was turned off. Unlock with your password, then turn it on again in Settings.`;
    case "missing":
      return null;
    default:
      return `${bioAction(kind)} did not work. Use your password.`;
  }
}

/** Show the prompt by itself when the unlock screen opens, at most once per lock. */
export function shouldAutoPrompt(o: { enabled: boolean; visible: boolean; alreadyTried: boolean; busy: boolean }): boolean {
  return o.enabled && o.visible && !o.alreadyTried && !o.busy;
}
