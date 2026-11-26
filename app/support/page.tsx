import type { Metadata } from "next";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { feedbackAreas, feedbackInbox, feedbackUser, recentFeedback, type FeedbackStatus } from "../../lib/feedback";
import { feedbackIntegrations } from "../../lib/feedback-integrations";
import { FeedbackForm, FeedbackState, TriageActions } from "./feedback-client";
import "./support.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Support · FitnessTrackr" };

const formatDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" });
const supportEmail = "varmisan.work@gmail.com";

export default async function Support({ searchParams }: {
  searchParams: Promise<{ inbox?: string; status?: string; page?: string }>;
}) {
  const viewer = await feedbackUser(await headers());
  const owner = viewer?.role === "owner";
  const params = await searchParams;
  const kind = params.inbox === "features" ? "feature" : "bug";
  const status: FeedbackStatus | "all" = params.status === "new" || params.status === "reviewing" || params.status === "resolved"
    ? params.status : "all";
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10_000 ? requestedPage : 1;
  const [history, inbox] = await Promise.all([
    viewer ? recentFeedback(viewer.id) : [],
    owner ? feedbackInbox(kind, status, page) : [],
  ]);
  const integrations = owner ? feedbackIntegrations() : null;
  const inboxUrl = (tab: "bugs" | "features", state = status, index = 1) =>
    `/support?inbox=${tab}&status=${state}&page=${index}#inbox`;
  const currentTab = kind === "bug" ? "bugs" : "features";

  return (
    <main className="support-shell">
      <header className="support-header">
        <a href={viewer ? "/?tab=Settings" : "/"} className="support-back">
          <ArrowLeft size={17} aria-hidden="true" /> {viewer ? "Settings" : "FitnessTrackr"}
        </a>
        {owner && <a href="#inbox">Feedback inbox</a>}
      </header>

      <section className="support-section" aria-labelledby="support-title">
        <div className="support-intro">
          <h1 id="support-title">FitnessTrackr support</h1>
          <p>Report a problem or suggest an improvement. Your feedback goes directly to the app owner.</p>
        </div>
        {viewer ? <FeedbackForm areas={feedbackAreas} /> : (
          <div className="support-sign-in">
            <p>Sign in to report a bug, suggest a feature or check your submissions.</p>
            <a className="support-primary" href="/">Open FitnessTrackr</a>
            <p>Can’t sign in? <a href={`mailto:${supportEmail}?subject=FitnessTrackr%20support`}>Email support</a> and describe what happened.</p>
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="support-section support-history" aria-labelledby="support-history">
          <h2 id="support-history">Your submissions</h2>
          <ul className="support-list">
            {history.map((report) => (
              <li key={report.id}>
                <div>
                  <strong>{report.title}</strong>
                  <p>{report.kind === "bug" ? "Bug report" : "Feature request"} · {formatDate.format(report.createdAt)}</p>
                </div>
                <FeedbackState status={report.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {integrations && (
        <section id="inbox" className="support-section support-inbox" aria-labelledby="support-inbox">
          <h2 id="support-inbox">Feedback inbox</h2>
          <nav aria-label="Feedback type" className="support-inbox-nav">
            <a aria-current={kind === "bug" ? "page" : undefined} href={inboxUrl("bugs")}>Bug reports</a>
            <a aria-current={kind === "feature" ? "page" : undefined} href={inboxUrl("features")}>Feature requests</a>
          </nav>
          <nav aria-label="Inbox status" className="support-inbox-nav">
            {([["all", "All"], ["new", "Received"], ["reviewing", "In review"], ["resolved", "Resolved"]] as const)
              .map(([value, label]) => <a key={value} href={inboxUrl(currentTab, value)} aria-current={status === value ? "page" : undefined}>{label}</a>)}
          </nav>
          {inbox.length === 0 && <p>{page === 1 ? "No feedback matches these filters." : "There’s no more feedback on this page."}</p>}
          {inbox.slice(0, 20).map(({ report, reporter }) => (
            <details key={report.id} className="support-report">
              <summary><strong>{report.title}</strong><FeedbackState status={report.status} /></summary>
              <div className="support-report-content">
                <p className="support-report-text">{report.description}</p>
                <dl className="support-report-meta">
                  <div><dt>Reporter</dt><dd>{reporter}</dd></div>
                  <div><dt>Reported</dt><dd>{formatDate.format(report.createdAt)}</dd></div>
                  {report.area && <div><dt>Area</dt><dd>{report.area}</dd></div>}
                  {report.context && <div><dt>Device context</dt><dd>{report.context}</dd></div>}
                  <div><dt>Reference</dt><dd>{report.id}</dd></div>
                </dl>
                <TriageActions
                  id={report.id} status={report.status} cannyLink={report.cannyLink} githubLink={report.githubLink}
                  canSendCanny={integrations.canny} canRequestFix={report.kind === "bug" && integrations.github}
                />
              </div>
            </details>
          ))}
          {(page > 1 || inbox.length > 20) && <nav aria-label="Inbox pages" className="support-inbox-nav">
            {page > 1 && <a href={inboxUrl(currentTab, status, page - 1)}>Previous page</a>}
            {inbox.length > 20 && <a href={inboxUrl(currentTab, status, page + 1)}>Next page</a>}
          </nav>}
        </section>
      )}

      <footer className="support-footer">
        {viewer && <a href={`mailto:${supportEmail}?subject=FitnessTrackr%20support`}>Email support</a>}
        <a href="/connect">Connect ChatGPT</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </footer>
    </main>
  );
}
