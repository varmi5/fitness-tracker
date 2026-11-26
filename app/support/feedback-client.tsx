"use client";

import { Bug, CheckCircle2, Lightbulb } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { FeedbackStatus } from "../../lib/feedback";

const statusLabels: Record<FeedbackStatus, string> = {
  new: "Received",
  reviewing: "In review",
  resolved: "Resolved",
};

export function FeedbackState({ status }: { status: FeedbackStatus }) {
  return <span className="support-status" data-status={status}>{statusLabels[status]}</span>;
}

async function postFeedback(data: object) {
  let response;
  try {
    response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    throw new Error("Couldn’t connect. Check your connection and try again.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.message ?? "Something went wrong. Try again in a moment.");
  return result;
}

export function FeedbackForm({ areas }: { areas: readonly string[] }) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const [kind, setKind] = useState<"bug" | "feature">("bug");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sent) confirmation.current?.focus();
  }, [sent]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    requestId.current ??= crypto.randomUUID();
    setPending(true);
    setError("");
    try {
      await postFeedback({
        action: "submit", id: requestId.current, kind,
        title: data.get("title"), description: data.get("description"),
        area: data.get("area") || undefined, includeContext: data.has("context"),
      });
      requestId.current = null;
      setSent(true);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn’t send feedback. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (sent) return (
    <div className="support-receipt">
      <CheckCircle2 size={25} aria-hidden="true" />
      <div>
        <h2 ref={confirmation} tabIndex={-1}>{kind === "bug" ? "Bug report received" : "Feature request received"}</h2>
        <p>Track its status under Your submissions.</p>
        <button type="button" className="secondary" onClick={() => { setSent(false); setKind("bug"); }}>Send more feedback</button>
      </div>
    </div>
  );

  return (
    <form onSubmit={submit} className="support-form">
      <fieldset disabled={pending} className="support-fields">
        <legend className="sr-only">Feedback type</legend>
        <div className="support-types">
          <label>
            <input className="sr-only" type="radio" name="kind" checked={kind === "bug"} onChange={() => setKind("bug")} />
            <Bug size={17} aria-hidden="true" /> Report a bug
          </label>
          <label>
            <input className="sr-only" type="radio" name="kind" checked={kind === "feature"} onChange={() => setKind("feature")} />
            <Lightbulb size={17} aria-hidden="true" /> Suggest a feature
          </label>
        </div>
        <label>
          {kind === "bug" ? "What went wrong?" : "What would you like to see?"}
          <input name="title" required minLength={3} maxLength={100} placeholder={kind === "bug" ? "e.g. A saved workout disappears" : "e.g. A weekly training summary"} />
        </label>
        <label>
          Details
          <textarea name="description" rows={4} required minLength={10} maxLength={3000} aria-describedby="feedback-details" placeholder={kind === "bug" ? "What were you doing, and what did you expect to happen?" : "When would you use it, and what would it help you do?"} />
          <small id="feedback-details">Leave out health records, passwords and access codes.</small>
        </label>
        {kind === "bug" && <>
          <label>
            Where did it happen? <small>(optional)</small>
            <select name="area" defaultValue="">
              <option value="">Choose an area</option>
              {areas.map((area) => <option key={area}>{area}</option>)}
            </select>
          </label>
          <label className="support-checkbox">
            <input name="context" type="checkbox" />
            Include my browser and operating system
          </label>
        </>}
        {error && <p className="support-error" role="alert">{error}</p>}
        <button type="submit" className="support-primary">{pending ? "Sending…" : kind === "bug" ? "Send bug report" : "Send feature request"}</button>
      </fieldset>
    </form>
  );
}

type Destination = "canny" | "github";

export function TriageActions({ id, status, cannyLink, githubLink, canSendCanny, canRequestFix }: {
  id: string;
  status: FeedbackStatus;
  cannyLink: string | null;
  githubLink: string | null;
  canSendCanny: boolean;
  canRequestFix: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const statusId = useId();
  const showHandoff = (canSendCanny && !cannyLink) || (canRequestFix && !githubLink);

  async function run(payload: object, success: string) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const result = await postFeedback({ ...payload, id });
      setNotice({ text: result.assigned === false ? "GitHub issue created. Open it to assign Copilot." : success });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Couldn’t update the report.", error: true });
    } finally {
      router.refresh();
      setPending(false);
    }
  }

  function handoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value as Destination | undefined;
    if (action !== "canny" && action !== "github") return;
    const form = new FormData(event.currentTarget);
    void run({ action, title: form.get("title"), summary: form.get("summary") },
      action === "github" ? "Sent to Copilot. Follow the draft PR from the GitHub issue." : "Summary sent to Canny.");
  }

  return (
    <div className="support-triage">
      <div className="support-status-control">
        <label htmlFor={statusId}>Status</label>
        <select id={statusId} value={status} disabled={pending} onChange={(event) => void run({ action: "status", status: event.target.value }, "Status updated.")}>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {cannyLink && (cannyLink === "pending"
        ? <p>Canny delivery is pending or unconfirmed. Check Canny using the report reference.</p>
        : <a href={cannyLink} target="_blank" rel="noreferrer">View Canny post</a>)}
      {githubLink && (githubLink === "pending"
        ? <p>GitHub delivery is pending or unconfirmed. Check GitHub using the report reference.</p>
        : <a href={githubLink} target="_blank" rel="noreferrer">View GitHub issue</a>)}
      {showHandoff && (
        <form onSubmit={handoff} className="support-handoff">
          <fieldset className="support-fields" disabled={pending}>
            <legend>Engineering handoff</legend>
            <p>Write a summary with synthetic examples and leave out the reporter’s personal details.</p>
            <label>Summary title<input name="title" required minLength={3} maxLength={100} /></label>
            <label>Reviewed summary<textarea name="summary" required rows={3} minLength={10} maxLength={3000} /></label>
            <div className="support-actions">
              {canRequestFix && !githubLink && <button className="support-primary" type="submit" value="github">Ask AI to propose a fix</button>}
              {canSendCanny && !cannyLink && <button className="secondary" type="submit" value="canny">Send to Canny</button>}
            </div>
          </fieldset>
        </form>
      )}
      {notice && <p role={notice.error ? "alert" : "status"} className={notice.error ? "support-error" : undefined}>{notice.text}</p>}
      {pending && <p role="status">Updating report…</p>}
    </div>
  );
}
