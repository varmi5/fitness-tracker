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
  return realFetch(input, init);
};
