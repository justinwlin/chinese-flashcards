const API = 'https://api.github.com';

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(String(value).replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function github(token, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  return response;
}

function explain(status, body) {
  let message = '';
  try {
    message = JSON.parse(body).message || '';
  } catch {
    message = body.slice(0, 180);
  }
  if (status === 401) return 'GitHub rejected the token. Paste a fine-grained token with Contents set to read and write.';
  if (status === 403) return `GitHub refused the edit (${message || '403'}). Set Contents to read and write on this repo only.`;
  if (status === 404) return 'That repo or branch has no file at this path. Check the owner, repo, and branch in Settings.';
  return message || `GitHub request failed (${status}).`;
}

export async function readContent({ token, owner, repo, branch, path }) {
  const response = await github(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`,
  );
  if (response.status === 404) return { missing: true, sha: null, text: '' };
  const body = await response.text();
  if (!response.ok) throw new Error(explain(response.status, body));
  const payload = JSON.parse(body);
  return { missing: false, sha: payload.sha, text: decodeBase64(payload.content || '') };
}

/**
 * Write a text file, refetching on sha conflicts.
 * `merge(remoteText)` returns the full text to store, or null to skip the write.
 */
export async function putContent({ token, owner, repo, branch, path, message, sha, text }) {
  const response = await github(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: encodeBase64(text),
        branch,
        ...(sha ? { sha } : {}),
      }),
    },
  );
  const body = await response.text();
  if (response.status === 409 || response.status === 422) return { conflict: true };
  if (!response.ok) throw new Error(explain(response.status, body));
  const payload = JSON.parse(body);
  return { conflict: false, sha: payload.content?.sha || null };
}

export async function writeContent({ token, owner, repo, branch, path, message, merge }) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remote = await readContent({ token, owner, repo, branch, path });
    const nextText = await merge(remote);
    if (nextText == null || (!remote.missing && remote.text === nextText)) {
      return { changed: false, text: remote.text, sha: remote.sha };
    }
    const response = await github(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message,
          content: encodeBase64(nextText),
          branch,
          ...(remote.sha ? { sha: remote.sha } : {}),
        }),
      },
    );
    const body = await response.text();
    if (response.status === 409 || response.status === 422) {
      lastError = new Error('The file changed while syncing.');
      continue;
    }
    if (!response.ok) throw new Error(explain(response.status, body));
    const payload = JSON.parse(body);
    return { changed: true, text: nextText, sha: payload.content?.sha || null };
  }
  throw lastError || new Error('Could not sync because the file kept changing. Try again.');
}

export { decodeBase64, encodeBase64 };
