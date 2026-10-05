import { memo, useCallback, useEffect, useState } from 'react';
import type { AgentEventType, AgentId } from '@shared/types';
import { AGENTS, PORT_MAX, PORT_MIN, curlSnippet, powershellSnippet } from './helpers';
import { ConfirmDialog, NumberField, Section, Toggle, useCtx } from './ui';

type Status = Record<string, { installed: boolean; path: string }>;
interface Pending {
  id: AgentId;
  name: string;
  action: 'install' | 'uninstall';
  file: string;
}

export const AgentsTab = memo(function AgentsTab() {
  const { settings, save, bridge, toast } = useCtx();
  const [status, setStatus] = useState<Status>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const port = settings.agents.port;

  const refresh = useCallback(() => {
    bridge.agentStatus().then(setStatus, () => toast('Could not read agent status', false));
  }, [bridge, toast]);
  useEffect(refresh, [refresh]);

  const run = (p: Pending): void => {
    setPending(null);
    setBusy(p.id);
    const call = p.action === 'install' ? bridge.installAgent(p.id) : bridge.uninstallAgent(p.id);
    const report = (ok: boolean, text: string): void => {
      setResult({ ok, text: `${p.name}: ${text}` });
      toast(text, ok);
    };
    call.then(
      (r) => report(r.ok, r.message || (r.ok ? 'Done' : 'Failed')),
      // Tauri rejects with the command's error as a plain string, not an Error.
      (e: unknown) => report(false, typeof e === 'string' ? e : e instanceof Error ? e.message : 'Failed'),
    ).finally(() => {
      setBusy(null);
      refresh();
    });
  };

  const sendTest = (t: AgentEventType): void => {
    bridge.testEvent(t).then(
      () => toast(`Sent test event: ${t}`),
      () => toast('Could not send test event', false),
    );
  };

  return (
    <Section title="AI Agents" intro="Let coding agents animate your critter (thinking, done, error). Hooks talk to a loopback-only local server.">
      <Toggle
        label="Enable agent events"
        hint="Runs a local server on 127.0.0.1 that agent hooks post to."
        checked={settings.agents.enabled}
        onChange={(on) => save((s) => ({ agents: { ...s.agents, enabled: on } }))}
      />
      <NumberField
        label="Port"
        hint="Takes effect after restart. Default 47626."
        value={port}
        min={PORT_MIN}
        max={PORT_MAX}
        onCommit={(n) => save((s) => ({ agents: { ...s.agents, port: n } }))}
      />

      <p className="hint">Install asks for confirmation first, then writes the hook entries.</p>
      <table className="table">
        <caption className="sr">Supported agents</caption>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {AGENTS.map((a) => {
            const st = status[a.id];
            const installed = !!st?.installed;
            const isGeneric = a.id === 'generic';
            return (
              <tr key={a.id}>
                <th scope="row">{a.name}</th>
                <td>
                  {isGeneric ? (
                    <span className="status manual">Manual</span>
                  ) : (
                    <span className={installed ? 'status ok' : 'status'}>
                      {installed ? 'Installed' : 'Not installed'}
                    </span>
                  )}
                </td>
                <td className="ta-right">
                  {!isGeneric && (
                    <button
                      type="button"
                      className={installed ? 'btn' : 'btn primary'}
                      disabled={busy === a.id}
                      aria-label={`${installed ? 'Uninstall' : 'Install'} ${a.name}`}
                      onClick={() =>
                        setPending({
                          id: a.id,
                          name: a.name,
                          action: installed ? 'uninstall' : 'install',
                          file: st?.path || a.file,
                        })
                      }
                    >
                      {installed ? 'Uninstall' : 'Install'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {result && (
        <p className={result.ok ? 'status ok' : 'status bad'} role="status" data-testid="agent-result">
          {result.text}
        </p>
      )}

      <h3>Send test event</h3>
      <div className="actions">
        {(['thinking', 'done', 'error'] as const).map((t) => (
          <button key={t} type="button" className="btn" onClick={() => sendTest(t)}>
            {t}
          </button>
        ))}
      </div>

      <details className="snippet">
        <summary>Manual setup for other tools</summary>
        <p className="hint">POST to the local server with the token from ~/.codecritter/token.</p>
        <h4>curl (bash)</h4>
        <pre tabIndex={0}>{curlSnippet(port)}</pre>
        <h4>PowerShell</h4>
        <pre tabIndex={0}>{powershellSnippet(port)}</pre>
      </details>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${pending.action === 'install' ? 'Install' : 'Uninstall'} ${pending.name} hooks?` : ''}
        confirmLabel={pending?.action === 'install' ? 'Install hooks' : 'Remove hooks'}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && run(pending)}
        body={
          pending && (
            <>
              <p>
                {pending.action === 'install'
                  ? 'CodeCritter will add its hook entries to this file. Your other settings are left untouched.'
                  : 'CodeCritter will remove only its own hook entries from this file.'}
              </p>
              <p>
                <code>{pending.file}</code>
              </p>
            </>
          )
        }
      />
    </Section>
  );
});
