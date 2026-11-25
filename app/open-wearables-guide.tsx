"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Download, ExternalLink, Info, Smartphone, Watch } from "lucide-react";
import type { OpenWearablesIntegrationStatus } from "./types";

type PlatformTab = "apple" | "android" | "cloud";

export interface OpenWearablesInvitePayload {
  code: string;
  expiresAt: string | null;
  apiUrl: string | null;
}

interface OpenWearablesGuideProps {
  openWearables?: OpenWearablesIntegrationStatus;
  invite: OpenWearablesInvitePayload | null;
  busy?: boolean;
  onGenerateInvite?: () => Promise<void>;
  onMessage: (msg: string) => void;
  formatExpiry?: (iso: string | null) => string;
  compact?: boolean;
}

export function OpenWearablesGuide({
  openWearables,
  invite,
  busy = false,
  onGenerateInvite,
  onMessage,
  formatExpiry,
  compact = false,
}: OpenWearablesGuideProps) {
  const [platform, setPlatform] = useState<PlatformTab>("apple");
  const defaultHostUrl = invite?.apiUrl || openWearables?.apiUrl || "https://wearables-api.hadamardsecurities.com";

  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      onMessage(`${label} copied.`);
    } catch {
      onMessage(`Copy blocked — select and copy the ${label.toLowerCase()} manually.`);
    }
  }

  return (
    <div className="ow-guide-box">
      <div className="ow-guide-intro">
        <div style={{ display: "flex", alignItems: "center", gap: ".4rem", flexWrap: "wrap" }}>
          <Info size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <strong style={{ fontSize: compact ? ".83rem" : ".88rem" }}>What is Open Wearables?</strong>
        </div>
        <p style={{ fontSize: ".78rem", color: "var(--muted)", margin: ".25rem 0 0", lineHeight: 1.45 }}>
          Open Wearables is our self-hosted bridge that lets non-Fitbit watches — <strong>Apple Watch</strong>,{" "}
          <strong>Garmin</strong>, <strong>Android Health Connect</strong>, <strong>Samsung</strong>, <strong>Oura</strong> &amp;{" "}
          <strong>Whoop</strong> — sync workouts, sleep, HRV and steps directly into FitnessTrackr with{" "}
          <strong>$0 subscription fees</strong> and automatic dual-watch deduplication.
        </p>
      </div>

      {/* Platform Switcher — wraps cleanly on 390px screens */}
      <div className="ow-guide-tabs" role="tablist" aria-label="Choose your watch or phone platform">
        <button
          type="button"
          role="tab"
          aria-selected={platform === "apple"}
          className={`ow-tab-btn${platform === "apple" ? " is-active" : ""}`}
          onClick={() => setPlatform("apple")}
        >
          <Smartphone size={14} /> Apple Health
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={platform === "android"}
          className={`ow-tab-btn${platform === "android" ? " is-active" : ""}`}
          onClick={() => setPlatform("android")}
        >
          <Smartphone size={14} /> Health Connect
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={platform === "cloud"}
          className={`ow-tab-btn${platform === "cloud" ? " is-active" : ""}`}
          onClick={() => setPlatform("cloud")}
        >
          <Watch size={14} /> Garmin / Oura / Whoop
        </button>
      </div>

      {/* Platform-Specific Download + Connection Steps */}
      {platform === "apple" && (
        <div className="ow-step-panel">
          <div className="ow-download-callout">
            <strong style={{ fontSize: ".8rem", display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              <Download size={14} style={{ color: "var(--teal)" }} /> How to download (iPhone / Apple Watch)
            </strong>
            <p style={{ fontSize: ".77rem", color: "var(--muted)", margin: ".25rem 0 0", lineHeight: 1.45 }}>
              Apple Health data lives privately on your iPhone (Apple has no web API), so it syncs via the{" "}
              <strong>Open Wearables iOS companion app</strong> (currently distributed in beta via <strong>TestFlight</strong>). Join the{" "}
              <a href="https://discord.gg/qrcfFnNE6H" target="_blank" rel="noreferrer">
                Open Wearables Discord <ExternalLink size={11} style={{ display: "inline" }} />
              </a>{" "}
              to request a TestFlight invite, or check the{" "}
              <a href="https://openwearables.io/docs/app/introduction" target="_blank" rel="noreferrer">
                App setup guide <ExternalLink size={11} style={{ display: "inline" }} />
              </a>
              . <em>Note: do not install the unrelated “OpenWearable” earable sensor app on the App Store.</em>
            </p>
          </div>

          <ol className="connector-steps ow-steps-list">
            <li>
              Tap <strong>{invite || openWearables?.owUserId ? "Generate New 8-Char Code" : "Generate 8-Char Connection Code"}</strong>{" "}
              below to create your private link code.
            </li>
            <li>
              Open the <strong>Open Wearables</strong> app on iPhone, enter our Host URL and your <strong>8-character code</strong>, and
              tap <strong>Connect</strong>.
            </li>
            <li>
              Grant <strong>Apple Health</strong> read access (Sleep, Workouts, Heart Rate, HRV, Steps) and tap{" "}
              <strong>Start Sync</strong> — updates then push to FitnessTrackr automatically.
            </li>
          </ol>
        </div>
      )}

      {platform === "android" && (
        <div className="ow-step-panel">
          <div className="ow-download-callout">
            <strong style={{ fontSize: ".8rem", display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              <Download size={14} style={{ color: "var(--teal)" }} /> How to download (Android / Samsung Health)
            </strong>
            <p style={{ fontSize: ".77rem", color: "var(--muted)", margin: ".25rem 0 0", lineHeight: 1.45 }}>
              1) Make sure Google <strong>Health Connect</strong> is enabled (built into Android 14+, or via Play Store) and your Samsung
              Health / watch app writes to it. 2) Install the <strong>Open Wearables Android beta APK</strong> via the{" "}
              <a href="https://discord.gg/qrcfFnNE6H" target="_blank" rel="noreferrer">
                Open Wearables Discord <ExternalLink size={11} style={{ display: "inline" }} />
              </a>{" "}
              or{" "}
              <a href="https://openwearables.io/docs/app/introduction" target="_blank" rel="noreferrer">
                App setup guide <ExternalLink size={11} style={{ display: "inline" }} />
              </a>
              .
            </p>
          </div>

          <ol className="connector-steps ow-steps-list">
            <li>
              Tap <strong>{invite || openWearables?.owUserId ? "Generate New 8-Char Code" : "Generate 8-Char Connection Code"}</strong>{" "}
              below.
            </li>
            <li>
              Open the <strong>Open Wearables</strong> Android app, paste our Host URL and your <strong>8-character code</strong>, and tap{" "}
              <strong>Connect</strong>.
            </li>
            <li>
              Pick <strong>Health Connect</strong> (or <strong>Samsung Health</strong> on Galaxy devices), grant read permissions, and tap{" "}
              <strong>Start Sync</strong>.
            </li>
          </ol>
        </div>
      )}

      {platform === "cloud" && (
        <div className="ow-step-panel">
          <div className="ow-download-callout">
            <strong style={{ fontSize: ".8rem", display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              <Watch size={14} style={{ color: "var(--teal)" }} /> Connecting Garmin, Oura, Whoop, Polar &amp; Strava
            </strong>
            <p style={{ fontSize: ".77rem", color: "var(--muted)", margin: ".25rem 0 0", lineHeight: 1.45 }}>
              You have two ways to sync cloud wearables:
            </p>
          </div>

          <ol className="connector-steps ow-steps-list">
            <li>
              <strong>Easiest (works right now, no developer approval needed):</strong> In <em>Garmin Connect</em>, <em>Oura</em>,{" "}
              <em>WHOOP</em>, or <em>Strava</em>, enable syncing to <strong>Apple Health</strong> (iPhone) or{" "}
              <strong>Health Connect</strong> (Android), then link using the Apple Health or Health Connect tab.
            </li>
            <li>
              <strong>Direct cloud OAuth (optional):</strong> Once your server admin adds provider OAuth keys in the{" "}
              <a href="https://wearables.hadamardsecurities.com" target="_blank" rel="noreferrer">
                Open Wearables portal <ExternalLink size={11} style={{ display: "inline" }} />
              </a>
              , workouts &amp; sleep sync cloud-to-cloud automatically even without the companion app.
            </li>
          </ol>
        </div>
      )}

      {/* Action CTA + Live Connection Status */}
      {openWearables?.connected && (
        <div className="pill teal-soft" style={{ justifySelf: "start" }}>
          <CheckCircle2 size={14} /> Connected{openWearables.accountLabel ? ` · ${openWearables.accountLabel}` : ""}
        </div>
      )}

      {onGenerateInvite && openWearables?.available !== false && (
        <button
          type="button"
          className={openWearables?.connected ? "secondary compact" : "unlock-btn"}
          style={{ width: "100%", justifyContent: "center" }}
          disabled={busy}
          onClick={() => void onGenerateInvite()}
        >
          {invite || openWearables?.owUserId ? "Generate New 8-Char Connection Code" : "Generate 8-Char Connection Code"}
        </button>
      )}

      {/* Invite Card: Copyable 8-char Code + Host URL (mobile-safe wrapping) */}
      {invite && (
        <div className="ow-invite-card">
          <div className="split-row" style={{ gap: ".45rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: ".76rem", color: "var(--muted)" }}>Your 8-character connection code</span>
            {invite.expiresAt && (
              <span className="pill accent-soft" style={{ fontSize: ".7rem" }}>
                Expires {formatExpiry ? formatExpiry(invite.expiresAt) : invite.expiresAt}
              </span>
            )}
          </div>
          <div className="ow-code-row">
            <code className="ow-code-pill">{invite.code}</code>
            <button
              type="button"
              className="secondary compact"
              onClick={() => void copyValue(invite.code, "Connection code")}
            >
              <Copy size={13} /> Copy Code
            </button>
          </div>
          <div style={{ display: "grid", gap: ".25rem", minWidth: 0 }}>
            <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>Open Wearables Host URL (paste into app)</span>
            <div className="ow-url-row">
              <code className="ow-url-text">{defaultHostUrl}</code>
              <button
                type="button"
                className="secondary compact"
                onClick={() => void copyValue(defaultHostUrl, "Host URL")}
              >
                <Copy size={13} /> Copy URL
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="ow-dual-tip">
        <strong>Two-watch tip:</strong> Swapping watches (e.g. Fitbit Air off, Apple Watch on for runs/gym) fills missing activity cleanly.
        Wearing two watches together auto-deduplicates workouts &amp; steps — just wear one consistent watch overnight for accurate HRV/RHR
        baselines.
      </p>
    </div>
  );
}
