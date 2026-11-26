import { FeedbackError } from "./feedback";

const githubRepo = "varmi5/fitness-tracker";
const copilot = "copilot-swe-agent[bot]";
const githubApi = `https://api.github.com/repos/${githubRepo}`;

type ReviewedFeedback = { id: string; title: string; summary: string };

export function feedbackIntegrations() {
  return {
    canny: Boolean(process.env.CANNY_API_KEY && process.env.CANNY_FEEDBACK_BOARD_ID && process.env.CANNY_FEEDBACK_AUTHOR_ID),
    github: Boolean(process.env.FEEDBACK_GITHUB_TOKEN),
  };
}

async function providerJson(url: string, name: string, init: RequestInit, sends = false) {
  try {
    const response = await fetch(url, {
      ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (sends && ![400, 401, 403, 404, 422, 429].includes(response.status)) {
        throw new Error("Unconfirmed provider delivery");
      }
      throw new FeedbackError(`${name} rejected the request. Check the integration settings and try again.`, 502);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof FeedbackError || sends) throw error;
    throw new FeedbackError(`${name} could not be reached. Try again in a moment.`, 502);
  }
}

export async function sendToCanny({ id, title, summary }: ReviewedFeedback) {
  if (!feedbackIntegrations().canny) throw new FeedbackError("The Canny integration needs to be configured.", 503);
  const boardID = process.env.CANNY_FEEDBACK_BOARD_ID;
  const authorID = process.env.CANNY_FEEDBACK_AUTHOR_ID;
  const request = (path: string, data: object, sends = false) =>
    providerJson(`https://canny.io/api/v1/${path}`, "Canny", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: process.env.CANNY_API_KEY, ...data }),
    }, sends);
  const board = await request("boards/retrieve", { id: boardID });
  if (board.id !== boardID || board.isPrivate !== true) {
    throw new FeedbackError("Choose a private Canny board for FitnessTrackr feedback.", 409);
  }
  const post = await request("posts/create", {
    boardID, authorID, title, details: `${summary}\n\nFitnessTrackr report: ${id}`,
  }, true);
  const link = new URL(post.url);
  const boardUrl = new URL(board.url);
  if (link.protocol !== "https:" || link.origin !== boardUrl.origin || link.username || link.password) {
    throw new Error("Unexpected Canny post link");
  }
  return { link: link.href };
}

export async function requestGithubFix({ id, title, summary }: ReviewedFeedback) {
  const token = process.env.FEEDBACK_GITHUB_TOKEN;
  if (!token) throw new FeedbackError("The GitHub integration needs to be configured.", 503);
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const repo = await providerJson(githubApi, "GitHub", { headers });
  if (repo.full_name !== githubRepo || repo.private !== true) {
    throw new FeedbackError("AI fixes require the private FitnessTrackr repository.", 409);
  }
  const issue = await providerJson(`${githubApi}/issues`, "GitHub", {
    method: "POST", headers,
    body: JSON.stringify({
      title,
      body: `${summary}\n\nFitnessTrackr report: ${id}`,
      assignees: [copilot],
      agent_assignment: {
        target_repo: githubRepo,
        base_branch: repo.default_branch,
        custom_instructions: "Use the owner-reviewed summary as bug context. Fix only the described application behaviour and add or run relevant regression checks. Use synthetic data. Open a draft pull request for owner review. Keep deployments, workflows, permissions, secrets and production data out of scope.",
      },
    }),
  }, true);
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error("Missing GitHub issue number");
  return {
    link: `https://github.com/${githubRepo}/issues/${issue.number}`,
    assigned: issue.assignees?.some((assignee: { login: string }) => assignee.login === copilot) ?? false,
  };
}
