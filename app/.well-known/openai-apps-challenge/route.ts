export const dynamic = "force-dynamic";

const DEFAULT_OPENAI_APPS_CHALLENGE = "1bh80Pgqg1cn1aJM7kyJQznU8EIweL";

export function GET() {
  const token = (process.env.OPENAI_APPS_CHALLENGE ?? DEFAULT_OPENAI_APPS_CHALLENGE).trim();
  if (!token) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(token, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
