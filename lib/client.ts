// Browser helpers shared by the pages.

/** Files above this are refused by the server (and by Vercel past 4.5 MB). */
export const MAX_UPLOAD = 4 * 1024 * 1024;

/** Reads a JSON reply, and turns a non-JSON one (Vercel's own "payload too large") into a plain message. */
export async function readJson(r: Response): Promise<any> {
  try {
    return await r.json();
  } catch {
    return { error: r.status === 413 ? "That file is over 4 MB. Try a smaller one." : `The server sent an unexpected reply (${r.status}). Try again.` };
  }
}
