import { FeedbackError, feedbackInput, feedbackUser, recordFeedback, sendFeedback, updateFeedbackStatus } from "../../../lib/feedback";
import { requestGithubFix, sendToCanny } from "../../../lib/feedback-integrations";
import { isSameAllowedOrigin } from "../../../lib/origins";
import { getAuthConfig } from "../../../lib/runtime";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function readPayload(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new FeedbackError("Expected a JSON request.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      void reader.cancel().catch(() => {});
      throw new FeedbackError("This report is too large.", 413);
    }
    body += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isSameAllowedOrigin(request, getAuthConfig())) {
    return json({ message: "A same-origin request is required." }, 403);
  }

  try {
    const user = await feedbackUser(request.headers);
    if (!user) return json({ message: "Sign in to send feedback." }, 401);

    const parsed = feedbackInput.safeParse(await readPayload(request));
    if (!parsed.success) return json({ message: parsed.error.issues[0]?.message ?? "Check the report fields." }, 400);
    const input = parsed.data;
    if (input.action === "submit") return json(await recordFeedback(user.id, input, request.headers), 201);
    if (user.role !== "owner") return json({ message: "The feedback inbox is available to the owner." }, 403);

    if (input.action === "status") {
      await updateFeedbackStatus(input.id, input.status);
      return json({ ok: true });
    }
    const send = input.action === "canny" ? sendToCanny : requestGithubFix;
    return json(await sendFeedback(input.id, input.action, () => send(input)));
  } catch (error) {
    if (error instanceof FeedbackError) return json({ message: error.message }, error.status);
    return json({ message: "FitnessTrackr could not complete this request. Try again in a moment." }, 500);
  }
}
