function normalizeOrigin(input: string): string | null {
  const t = input.trim().replace(/\/$/, "");
  if (!t) return null;
  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    return u.origin;
  } catch {
    return null;
  }
}

export function getAuthCallbackUrl(): string {
  if (typeof window === "undefined") return "";
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const fromEnv = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  const origin = isLocal ? window.location.origin : (fromEnv ?? window.location.origin);
  return `${origin}/auth/callback`;
}
