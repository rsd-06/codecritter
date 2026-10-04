import { memo } from 'react';
import { Section } from './ui';

export const VERSION = '0.1.0';
export const REPO_URL = 'https://github.com/rsd-06/codecritter';

export const AboutTab = memo(function AboutTab() {
  return (
    <Section title="About">
      <p className="about-line">
        <strong>CodeCritter</strong> v{VERSION} &middot; MIT licensed
      </p>
      <p>
        Source:{' '}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => {
            e.preventDefault();
            window.open(REPO_URL, '_blank', 'noopener,noreferrer');
          }}
        >
          {REPO_URL}
        </a>
      </p>

      <h3>Privacy</h3>
      <ul className="plain">
        <li>No telemetry and no analytics. CodeCritter makes no outbound network requests.</li>
        <li>Only the number of key presses is counted. Which keys you press is never read or stored.</li>
        <li>The agent server listens on loopback (127.0.0.1) only and requires a local token.</li>
        <li>Your settings stay on this computer unless you choose a sync folder.</li>
      </ul>

      <h3>Fan art disclaimer</h3>
      <p className="hint">
        Stitch is a trademark and copyright of Disney. Yoda is a trademark and copyright of Lucasfilm. CodeCritter is
        an unofficial fan project and is not affiliated with, endorsed by, or sponsored by Disney or Lucasfilm.
      </p>
    </Section>
  );
});
