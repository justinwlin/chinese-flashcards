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
  try {
    return await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'network error';
    throw new Error(`GitHub network error: ${reason}`);
  }
}

export function githubError(status, body) {
  let message = '';
  try {
    message = JSON.parse(body).message || '';
  } catch {
    message = String(body || '').replace(/\s+/g, ' ').slice(0, 300);
  }
  if (status === 401) {
    return `GitHub 401: ${message || 'Bad credentials.'} Paste a fine-grained token with Contents set to read and write.`;
  }
  if (status === 403) {
    return `GitHub 403: ${message || 'Forbidden.'} Set Contents to read and write on this repo only.`;
  }
  if (status === 404) {
    return `GitHub 404: ${message || 'Not Found.'} Check the token, owner, repo, and branch.`;
  }
  return `GitHub ${status}: ${message || 'request failed'}`;
}

function shaConflict(status, body) {
  if (status === 409) return true;
  if (status !== 422) return false;
  const text = String(body).toLowerCase();
  return text.includes('sha') && (text.includes('does not match') || text.includes('mismatch'));
}

export async function readContent({ token, owner, repo, branch, path }) {
  const response = await github(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`,
  );
  if (response.status === 404) return { missing: true, sha: null, text: '', status: 404 };
  const body = await response.text();
  if (!response.ok) throw new Error(githubError(response.status, body));
  const payload = JSON.parse(body);
  return { missing: false, sha: payload.sha, text: decodeBase64(payload.content || '') };
}

/**
 * Write a text file, refetching on sha conflicts.
 * `merge(remoteText)` returns the full text to store, or null to skip the write.
 */
export async function putContent({ token, owner, repo, branch, path, message, sha, text, keepalive = false }) {
  const response = await github(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    {
      method: 'PUT',
      keepalive,
      body: JSON.stringify({
        message,
        content: encodeBase64(text),
        branch,
        ...(sha ? { sha } : {}),
      }),
    },
  );
  const body = await response.text();
  if (shaConflict(response.status, body)) return { conflict: true };
  if (response.status !== 200 && response.status !== 201) throw new Error(githubError(response.status, body));
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`GitHub ${response.status}: response was not JSON.`);
  }
  const commitSha = payload.commit?.sha;
  if (!commitSha) throw new Error(`GitHub ${response.status}: response had no commit sha.`);
  return { conflict: false, status: response.status, commitSha, contentSha: payload.content?.sha || null };
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
    if (shaConflict(response.status, body)) {
      lastError = new Error(`GitHub ${response.status}: the file changed while syncing.`);
      continue;
    }
    if (response.status !== 200 && response.status !== 201) throw new Error(githubError(response.status, body));
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`GitHub ${response.status}: response was not JSON.`);
    }
    if (!payload.commit?.sha) throw new Error(`GitHub ${response.status}: response had no commit sha.`);
    return { changed: true, text: nextText, sha: payload.commit.sha, status: response.status };
  }
  throw lastError || new Error('Could not sync because the file kept changing. Try again.');
}

export { decodeBase64, encodeBase64 };
