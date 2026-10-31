import { versionLabel } from '../lib/version.js';

export function VersionLabel() {
  const label = versionLabel();
  return <p class="version">{label}</p>;
}
