import { writeFile } from "node:fs/promises";
const realFetch = globalThis.fetch;
const consumed = new Set();
globalThis.fetch = async (input, init) => {
  if (input === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    const token = init.body.get("response");
    if (consumed.has(token)) return Response.json({ success: false });
    consumed.add(token);
    return Response.json({
      success: true,
      action: token === "wrong-action" ? "login" : "signup",
      hostname: token === "wrong-host" ? "elsewhere.example.test" : "localhost",
    });
  }
  if (input === "https://api.resend.com/emails") {
    await writeFile(process.env.FITNESS_TEST_EMAIL, init.body, { mode: 0o600 });
    return Response.json({ id: "local-verification-message" });
  }
  if (input === "https://canny.io/api/v1/boards/retrieve") {
    return Response.json({ id: "test-board", isPrivate: true, url: "https://fitness-test.canny.io/admin/board/feedback" });
  }
  if (input === "https://canny.io/api/v1/posts/create") {
    const { apiKey, boardID, authorID, title, details } = JSON.parse(init.body);
    if (apiKey !== "test-canny" || boardID !== "test-board" || authorID !== "test-author" ||
      title !== "Workout save issue" || !details.startsWith("Reproduce with a synthetic workout.") || details.includes("member@example.test")) {
      return Response.json({}, { status: 422 });
    }
    return Response.json({ id: "synthetic-post", url: "https://fitness-test.canny.io/admin/board/feedback/p/workout-save-issue" });
  }
  if (input === "https://api.github.com/repos/varmi5/fitness-tracker") {
    return Response.json({ full_name: "varmi5/fitness-tracker", private: true, default_branch: "main" });
  }
  if (input === "https://api.github.com/repos/varmi5/fitness-tracker/issues") {
    const { title, body, assignees, agent_assignment } = JSON.parse(init.body);
    if (init.headers.Authorization !== "Bearer test-github" || title !== "Workout save issue" ||
      !body.startsWith("Reproduce with a synthetic workout.") || body.includes("member@example.test") ||
      !assignees.includes("copilot-swe-agent[bot]") || agent_assignment.base_branch !== "main") {
      return Response.json({}, { status: 422 });
    }
    return Response.json({ number: 123, assignees: [{ login: "copilot-swe-agent[bot]" }] }, { status: 201 });
  }
  return realFetch(input, init);
};
