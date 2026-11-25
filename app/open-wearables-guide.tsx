"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { AppleHealthIcon, GarminBrandIcon, HealthConnectIcon } from "../components/icons";
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
  initialPlatform?: PlatformTab;
  hideTabs?: boolean;
  onGenerateInvite?: () => Promise<void>;
  onMessage: (msg: string) => void;
  formatExpiry?: (iso: string | null) => string;
  compact?: boolean;
}

export function OpenWearablesGuide({
  openWearables,
  invite,
  busy = false,
  initialPlatform = "apple",
  hideTabs = false,
  onGenerateInvite,
  onMessage,
  formatExpiry,
  compact = false,
}: OpenWearablesGuideProps) {
  const [platform, setPlatform] = useState<PlatformTab>(initialPlatform);

  useEffect(() => {
    setPlatform(initialPlatform);
  }, [initialPlatform]);

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
      {!hideTabs && (
        <div className="ow-guide-tabs" role="tablist" aria-label="Choose watch or phone platform">
          <button
            type="button"
            role="tab"
            aria-selected={platform === "apple"}
            className={`ow-tab-btn${platform === "apple" ? " is-active" : ""}`}
            onClick={() => setPlatform("apple")}
          >
            <AppleHealthIcon size={16} /> Apple Health
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={platform === "android"}
            className={`ow-tab-btn${platform === "android" ? " is-active" : ""}`}
            onClick={() => setPlatform("android")}
          >
            <HealthConnectIcon size={16} /> Health Connect
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={platform === "cloud"}
            className={`ow-tab-btn${platform === "cloud" ? " is-active" : ""}`}
            onClick={() => setPlatform("cloud")}
          >
            <GarminBrandIcon size={16} /> Garmin / Oura / Whoop
          </button>
        </div>
      )}

      {platform === "apple" && (
        <div className="ow-step-panel">
          <div style={{ display: "flex", alignItems: "center", gap: ".55rem", minWidth: 0 }}>
            <span className="device-logo-tile" aria-hidden="true">
              <AppleHealthIcon size={22} />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: compact ? ".86rem" : ".9rem", display: "block" }}>
                Sync Apple Watch &amp; Apple Health
              </strong>
              <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
                Uses the free Open Wearables iPhone helper app (TestFlight beta).
              </span>
            </div>
          </div>

          <div className="ow-step-list">
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">1</span>
              <div className="ow-step-copy">
                <strong>Get the helper app</strong>
                <span>
                  Grab a free beta invite on{" "}
                  <a href="https://discord.gg/qrcfFnNE6H" target="_blank" rel="noreferrer">
                    TestFlight (Discord) <ExternalLink size={11} style={{ display: "inline" }} />
                  </a>
                  {" "}· <em style={{ color: "var(--muted)" }}>skip “OpenWearable” on App Store</em>
                </span>
              </div>
            </div>
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">2</span>
              <div className="ow-step-copy">
                <strong>Tap Get Link Code below</strong>
                <span>Creates your 8-character code and Host URL.</span>
              </div>
            </div>
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">3</span>
              <div className="ow-step-copy">
                <strong>Connect &amp; Start Sync</strong>
                <span>Paste Host URL + code in the app, allow Apple Health, tap <strong>Start Sync</strong>.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {platform === "android" && (
        <div className="ow-step-panel">
          <div style={{ display: "flex", alignItems: "center", gap: ".55rem", minWidth: 0 }}>
            <span className="device-logo-tile" aria-hidden="true">
              <HealthConnectIcon size={22} />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: compact ? ".86rem" : ".9rem", display: "block" }}>
                Sync Android Health Connect &amp; Samsung
              </strong>
              <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
                Uses Health Connect (built into Android 14+) + the free helper app.
              </span>
            </div>
          </div>

          <div className="ow-step-list">
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">1</span>
              <div className="ow-step-copy">
                <strong>Get the Android helper app</strong>
                <span>
                  Install the beta APK from{" "}
                  <a href="https://discord.gg/qrcfFnNE6H" target="_blank" rel="noreferrer">
                    Discord <ExternalLink size={11} style={{ display: "inline" }} />
                  </a>{" "}
                  and enable <strong>Health Connect</strong>.
                </span>
              </div>
            </div>
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">2</span>
              <div className="ow-step-copy">
                <strong>Tap Get Link Code below</strong>
                <span>Creates your 8-character code and Host URL.</span>
              </div>
            </div>
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">3</span>
              <div className="ow-step-copy">
                <strong>Pick Health Connect or Samsung</strong>
                <span>Paste Host URL + code in the app, allow access &amp; tap <strong>Start Sync</strong>.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {platform === "cloud" && (
        <div className="ow-step-panel">
          <div style={{ display: "flex", alignItems: "center", gap: ".55rem", minWidth: 0 }}>
            <span className="device-logo-tile" aria-hidden="true">
              <GarminBrandIcon size={22} />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: compact ? ".86rem" : ".9rem", display: "block" }}>
                Sync Garmin, Oura, WHOOP &amp; Strava
              </strong>
              <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
                Fastest setup: bridge through Apple Health or Health Connect.
              </span>
            </div>
          </div>

          <div className="ow-step-list">
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">1</span>
              <div className="ow-step-copy">
                <strong>Turn on Apple Health or Health Connect</strong>
                <span>Inside your Garmin Connect, Oura, WHOOP, or Strava app settings.</span>
              </div>
            </div>
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">2</span>
              <div className="ow-step-copy">
                <strong>Link via the helper app</strong>
                <span>
                  Tap <strong>Get Link Code</strong> below, or pair direct cloud OAuth in the{" "}
                  <a href="https://wearables.hadamardsecurities.com" target="_blank" rel="noreferrer">
                    web portal <ExternalLink size={11} style={{ display: "inline" }} />
                  </a>
                  .
                </span>
              </div>
            </div>
            <div className="ow-step-row">
              <span className="ow-step-num" aria-hidden="true">3</span>
              <div className="ow-step-copy">
                <strong>Done — automatic sync</strong>
                <span>Workouts, sleep, HRV &amp; steps flow in automatically.</span>
              </div>
            </div>
          </div>
        </div>
      )}

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
          {invite || openWearables?.owUserId ? "Generate New Link Code" : "Get Link Code"}
        </button>
      )}

      {invite && (
        <div className="ow-invite-card">
          <div className="split-row" style={{ gap: ".45rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Your 8-character code</span>
            {invite.expiresAt && (
              <span className="pill accent-soft" style={{ fontSize: ".69rem" }}>
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
            <span style={{ fontSize: ".73rem", color: "var(--muted)" }}>Host URL (paste into app)</span>
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
        Wear two watches? Overlapping workouts auto-dedupe; wear one watch overnight for steady baselines.
      </p>
    </div>
  );
}
