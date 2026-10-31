import { useEffect, useState } from 'preact/hooks';
import { formatSyncLine } from '../lib/sync.js';

function Segment({ label, value, options, onChange }) {
  return (
    <fieldset class="segment-field">
      <legend>{label}</legend>
      <div class="segment">
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Settings({
  settings,
  token,
  syncing,
  syncMessage,
  syncIsError,
  lastSync,
  warning,
  installEvent,
  onSettings,
  onSaveToken,
  onForgetToken,
  onSync,
  onExport,
  onImport,
  onReset,
}) {
  const [draftToken, setDraftToken] = useState(token || '');
  useEffect(() => setDraftToken(token || ''), [token]);
  const [showToken, setShowToken] = useState(false);
  const [importError, setImportError] = useState('');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const saveToken = () => onSaveToken(draftToken);

  return (
    <section class="screen settings">
      {warning && <p class="banner" role="status">{warning}</p>}

      <Segment
        label="Theme"
        value={settings.theme}
        onChange={(theme) => onSettings({ ...settings, theme })}
        options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]}
      />
      <Segment
        label="Card faces"
        value={settings.directions}
        onChange={(directions) => onSettings({ ...settings, directions })}
        options={[['both', 'Both'], ['read', 'Read'], ['write', 'Write']]}
      />

      <label>
        New cards per day
        <input
          type="number"
          min="0"
          max="200"
          inputMode="numeric"
          value={settings.newPerDay}
          onInput={(event) => onSettings({ ...settings, newPerDay: event.currentTarget.value })}
        />
      </label>

      <label class="check">
        <input
          type="checkbox"
          checked={settings.speakOnReveal}
          onChange={(event) => onSettings({ ...settings, speakOnReveal: event.currentTarget.checked })}
        />
        Speak the word when the answer is shown
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={settings.syncOnOpen}
          onChange={(event) => onSettings({ ...settings, syncOnOpen: event.currentTarget.checked })}
        />
        Sync when the app opens, if a token is saved
      </label>

      <section class="panel">
        <h2>GitHub sync</h2>
        <p>
          A fine-grained token stays in this device's storage. Reviews sync about a second after you grade them, and again when the app opens. The token updates
          <code> words.json</code> and <code> progress.json</code> on GitHub. Without a token,
          reviews stay on this phone.
        </p>
        <label>
          Token
          <input
            type={showToken ? 'text' : 'password'}
            value={draftToken}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            placeholder="github_pat_…"
            onInput={(event) => setDraftToken(event.currentTarget.value)}
          />
        </label>
        <div class="row">
          <button type="button" class="secondary" onClick={() => setShowToken((value) => !value)}>
            {showToken ? 'Hide' : 'Show'}
          </button>
          <button type="button" class="secondary" onClick={saveToken}>Save on this device</button>
        </div>
        <button
          type="button"
          class="primary"
          disabled={syncing}
          onClick={() => {
            onSaveToken(draftToken);
            onSync(draftToken, { manual: true });
          }}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        {token && (
          <button type="button" class="danger" onClick={onForgetToken}>Forget token</button>
        )}
        <p class="sync-line" role="status" title={lastSync?.commit || undefined}>{formatSyncLine(lastSync)}</p>
        {syncMessage && <p class={syncIsError ? 'form-error' : 'sync-message'} role="status">{syncMessage}</p>}
        <details>
          <summary>Repo</summary>
          <label>
            Owner
            <input value={settings.owner} autoCapitalize="none" autoCorrect="off" onInput={(event) => onSettings({ ...settings, owner: event.currentTarget.value })} />
          </label>
          <label>
            Repository
            <input value={settings.repo} autoCapitalize="none" autoCorrect="off" onInput={(event) => onSettings({ ...settings, repo: event.currentTarget.value })} />
          </label>
          <label>
            Branch
            <input value={settings.branch} autoCapitalize="none" autoCorrect="off" onInput={(event) => onSettings({ ...settings, branch: event.currentTarget.value })} />
          </label>
        </details>
      </section>

      <section class="panel">
        <h2>Backup</h2>
        <p>Export includes words and review progress. It does not include the token.</p>
        <div class="row">
          <button type="button" class="secondary" onClick={onExport}>Export JSON</button>
          <label class="file-button">
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                try {
                  setImportError('');
                  await onImport(file);
                } catch (error) {
                  setImportError(error.message || 'Could not import that file.');
                }
              }}
            />
          </label>
        </div>
        {importError && <p class="form-error" role="alert">{importError}</p>}
      </section>

      {!standalone && (
        <section class="panel">
          <h2>Install on iPhone</h2>
          <ol>
            <li>Open this site in Safari.</li>
            <li>Tap Share, then Add to Home Screen.</li>
            <li>Open 中文卡 from the home screen once while online.</li>
          </ol>
          {ios ? <p>Safari is the browser that can install this app.</p> : null}
          {installEvent && (
            <button
              type="button"
              class="secondary"
              onClick={async () => {
                installEvent.prompt();
                await installEvent.userChoice;
              }}
            >
              Install app
            </button>
          )}
        </section>
      )}

      <section class="panel">
        <h2>Reset</h2>
        <button type="button" class="danger" onClick={onReset}>Erase review progress</button>
      </section>
    </section>
  );
}
