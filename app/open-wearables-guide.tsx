"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import type { OpenWearablesIntegrationStatus } from "./types";

type DataSource = "apple" | "android" | "cloud";

const sources: Record<DataSource, string> = {
  apple: "Apple Health",
  android: "Health Connect or Samsung Health",
  cloud: "Garmin, Oura, WHOOP or Strava",
};

const steps = ["Install", "Get code", "Sync"];

export interface OpenWearablesInvitePayload {
  code: string;
  expiresAt: string | null;
  apiUrl: string | null;
}

interface OpenWearablesGuideProps {
  openWearables?: OpenWearablesIntegrationStatus;
  invite: OpenWearablesInvitePayload | null;
  busy?: boolean;
  initialPlatform?: DataSource;
  hideSourcePicker?: boolean;
  onGenerateInvite?: () => Promise<void>;
  onMessage: (msg: string) => void;
  formatExpiry?: (iso: string | null) => string;
}

export function OpenWearablesGuide({
  openWearables,
  invite,
  busy = false,
  initialPlatform = "apple",
  hideSourcePicker = false,
  onGenerateInvite,
  onMessage,
  formatExpiry,
}: OpenWearablesGuideProps) {
  const [source, setSource] = useState<DataSource>(initialPlatform);
  const [step, setStep] = useState(0);
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const focusStep = useRef(false);
  const hostUrl = invite?.apiUrl || openWearables?.apiUrl;
  const apple = source === "apple";
  const canGenerate = onGenerateInvite && openWearables?.available !== false;

  useEffect(() => {
    setSource(initialPlatform);
    setStep(0);
  }, [initialPlatform]);

  useEffect(() => {
    if (focusStep.current) {
      panel.current?.focus();
      focusStep.current = false;
    }
  }, [step]);

  function advanceTo(nextStep: number) {
    focusStep.current = true;
    setStep(nextStep);
  }

  function chooseSource(nextSource: DataSource) {
    setSource(nextSource);
    setStep(0);
  }

  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      onMessage(`${label} copied.`);
    } catch {
      onMessage(`Select and copy the ${label.toLowerCase()} manually.`);
    }
  }

  return (
    <div className="ow-guide-box">
      <div className="ow-guide-heading">
        <strong>Open Wearables</strong>
        <span className="pill amber-soft">Beta</span>
      </div>

      {hideSourcePicker ? (
        <p className="ow-detail">{sources[source]}</p>
      ) : (
        <label className="ow-source-picker">
          <span>Data source</span>
          <select value={source} onChange={(event) => chooseSource(event.target.value as DataSource)}>
            {Object.entries(sources).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      )}

      {source === "cloud" ? (
        <div className="ow-step-panel">
          <strong>Choose how to connect</strong>
          <p className="ow-detail">If your wearable app shares data with Apple Health or Health Connect, turn on sharing there first.</p>
          <div className="button-row">
            <button type="button" className="secondary compact" onClick={() => chooseSource("apple")}>Use Apple Health</button>
            <button type="button" className="secondary compact" onClick={() => chooseSource("android")}>Use Health Connect</button>
          </div>
          <a href="https://wearables.hadamardsecurities.com" target="_blank" rel="noreferrer">
            Open Wearables web portal <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      ) : (
        <>
          <nav className="ow-guide-tabs" aria-label="Open Wearables setup steps">
            {steps.map((label, index) => (
              <button
                key={label}
                type="button"
                className={`ow-tab-btn${step === index ? " is-active" : ""}`}
                aria-current={step === index ? "step" : undefined}
                aria-controls={panelId}
                onClick={() => setStep(index)}
              >
                {index + 1}. {label}
              </button>
            ))}
          </nav>
          <div className="ow-step-panel" id={panelId} ref={panel} tabIndex={-1} aria-label={`Step ${step + 1} of ${steps.length}`}>
            {step === 0 && (
              <>
                <strong>Install Open Wearables</strong>
                <p className="ow-detail">{apple ? "Open the invite on your iPhone and install the beta in TestFlight." : "Request the Android beta APK and enable Health Connect."}</p>
                <a
                  className="ow-install-link"
                  href={apple ? "https://testflight.apple.com/join/h2Pv8Dbe" : "https://discord.gg/qrcfFnNE6H"}
                  target="_blank"
                  rel="noreferrer"
                >
                  {apple ? "Open TestFlight invite" : "Get Android beta"} <ExternalLink size={13} aria-hidden="true" />
                </a>
                <button type="button" className="unlock-btn" onClick={() => advanceTo(1)}>
                  I have the app
                </button>
              </>
            )}
            {step === 1 && (
              <>
                <strong>Get your pairing code</strong>
                <p className="ow-detail">Use this one-time code and Host URL in Open Wearables.</p>
                {canGenerate && !invite && (
                  <button
                    type="button"
                    className="unlock-btn"
                    disabled={busy}
                    onClick={() => void onGenerateInvite?.()}
                  >
                    {busy ? "Getting code…" : "Get link code"}
                  </button>
                )}
                {invite && (
                  <div className="ow-invite-card" role="group" aria-label="Pairing details" aria-live="polite">
                    <span className="ow-detail">
                      Pairing code{invite.expiresAt ? ` · Expires ${formatExpiry ? formatExpiry(invite.expiresAt) : new Date(invite.expiresAt).toLocaleString()}` : ""}
                    </span>
                    <div className="ow-code-row">
                      <code className="ow-code-pill">{invite.code}</code>
                      <button type="button" className="secondary compact" onClick={() => void copyValue(invite.code, "Code")}>
                        <Copy size={13} aria-hidden="true" /> Copy code
                      </button>
                    </div>
                    {hostUrl && (
                      <>
                        <span className="ow-detail">Host URL</span>
                        <div className="ow-url-row">
                          <code className="ow-url-text">{hostUrl}</code>
                          <button type="button" className="secondary compact" onClick={() => void copyValue(hostUrl, "Host URL")}>
                            <Copy size={13} aria-hidden="true" /> Copy URL
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {invite && (
                  <button type="button" className="unlock-btn" onClick={() => advanceTo(2)}>Next · Sync</button>
                )}
                {canGenerate && invite && (
                  <button type="button" className="secondary compact ow-regenerate" disabled={busy} onClick={() => void onGenerateInvite()}>
                    {busy ? "Getting code…" : "Get a new code"}
                  </button>
                )}
              </>
            )}
            {step === 2 && (
              <>
                <strong>Connect and sync</strong>
                <ol className="ow-steps-list">
                  <li>In Open Wearables, paste your Host URL and code, then tap <strong>Connect</strong>.</li>
                  <li>Allow access to {apple ? "Apple Health" : "Health Connect or Samsung Health"} and tap <strong>Start Sync</strong>.</li>
                  <li>Return to FitnessTrackr and refresh to check your data.</li>
                </ol>
                {apple && <p className="ow-detail">Fitbit Air syncs separately through Google Health.</p>}
                <button type="button" className="secondary compact" onClick={() => advanceTo(1)}>Back to pairing code</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
