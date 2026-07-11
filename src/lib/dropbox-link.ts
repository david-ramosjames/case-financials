/** Normalize a pasted Dropbox shared link for storage. */
export function normalizeDropboxPermalink(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Dropbox link is required");

  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Enter a valid Dropbox shared link");
  }

  const host = url.hostname.toLowerCase();
  if (!host.endsWith("dropbox.com") && host !== "db.tt") {
    throw new Error("Link must be a Dropbox shared link (dropbox.com)");
  }

  url.protocol = "https:";
  url.hash = "";
  return url.toString();
}

export function isDropboxPermalink(value: string): boolean {
  try {
    normalizeDropboxPermalink(value);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort display label from a Dropbox URL or path hint. */
export function dropboxDisplayLabel(permalink: string, fileNameHint?: string | null): string {
  const hint = fileNameHint?.trim();
  if (hint) return hint;

  try {
    const url = new URL(permalink);
    const fromPath = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    if (fromPath && !fromPath.startsWith("scl/") && !fromPath.startsWith("s/")) {
      return fromPath;
    }
  } catch {
    /* ignore */
  }

  return "Dropbox file";
}
