// The Linux port cannot always replace itself in place (distro packages are owned by the package
// manager) and the login-item toggle drives three different mechanisms. Both used to promise Windows
// behaviour on every platform; these tests pin the platform-neutral wording.
import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@shared/types';
import { AUTOSTART_LABEL, installButtonLabel, updateSourceLine, updateStatusLine } from './General';

const SOURCE = 'https://github.com/rsd-06/codecritter/releases/latest';
const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  currentVersion: '0.2.1',
  lastCheckedAt: null,
  available: false,
  downloaded: false,
  source: SOURCE,
  ...over,
});

describe('autostart label', () => {
  it('names no operating system', () => {
    expect(AUTOSTART_LABEL).toBe('Start at login');
    for (const os of ['Windows', 'Linux', 'macOS', 'Mac']) {
      expect(AUTOSTART_LABEL, `label must not mention ${os}`).not.toContain(os);
    }
  });
});

describe('update copy on a package-managed install', () => {
  const pkg = status({ available: true, version: '0.3.0', manualInstall: true });
  const selfUpdating = status({ available: true, version: '0.3.0', manualInstall: false });

  it('never promises an in-app install when manualInstall is set', () => {
    expect(updateStatusLine(pkg)).toBe('v0.3.0 is available. Download it from the releases page.');
    expect(installButtonLabel(pkg)).toBe('Download v0.3.0');
    expect(updateStatusLine(pkg)).not.toMatch(/restart/i);
    expect(installButtonLabel(pkg)).not.toMatch(/restart/i);
  });

  it('keeps the in-app install wording where the platform can self-update', () => {
    expect(updateStatusLine(selfUpdating)).toBe('v0.3.0 is available.');
    expect(installButtonLabel(selfUpdating)).toBe('Install v0.3.0 and restart');
  });

  it('treats an absent manualInstall (older backend) as self-updating', () => {
    const legacy = status({ available: true, version: '0.3.0' });
    expect(updateStatusLine(legacy)).toBe('v0.3.0 is available.');
    expect(installButtonLabel(legacy)).toBe('Install v0.3.0 and restart');
  });
});

describe('update copy without an update', () => {
  it('is unchanged and never mentions installing', () => {
    expect(updateStatusLine(null)).toBe('Not checked yet.');
    expect(updateStatusLine(status())).toBe('Not checked yet.');
    expect(updateStatusLine(status({ manualInstall: true }))).toBe('Not checked yet.');
    expect(updateStatusLine(status({ lastCheckedAt: 1 }))).toContain('Up to date');
    expect(updateStatusLine(status({ error: 'offline' }))).toContain('Could not check');
    // A downloaded-and-ready update is impossible on a package install, but if one is ever reported the
    // auto-install wording must not be silently changed for the platforms that do self-update.
    expect(updateStatusLine(status({ downloaded: true, version: '0.3.0' }))).toContain('installs when you are away');
  });
});

// Release ownership: a build made from a fork consumes the upstream project's releases, so the UI must
// name that project instead of implying an update is a rebuild of this copy. See updater::RELEASES_PAGE.
describe('update source is disclosed', () => {
  it('always names the releases page the build consumes', () => {
    expect(updateSourceLine(status())).toContain(SOURCE);
    expect(updateSourceLine(status({ manualInstall: true }))).toContain(SOURCE);
  });

  it('warns that a self-install replaces this copy with the upstream build', () => {
    const line = updateSourceLine(status({ manualInstall: false }));
    expect(line).toContain(SOURCE);
    expect(line).toContain('replaces this copy');
  });

  it('explains instead that a package install is not replaced in place', () => {
    const line = updateSourceLine(status({ manualInstall: true }));
    expect(line).toContain('package manager');
    expect(line).not.toContain('replaces this copy');
  });

  it('renders nothing when the backend does not report a source (older build, mock bridge)', () => {
    expect(updateSourceLine(status({ source: undefined }))).toBe('');
    expect(updateSourceLine(null)).toBe('');
  });
});