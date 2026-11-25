import { getAppBootstrap } from "../../../lib/app-bootstrap";
import { authConfigured } from "../../../lib/runtime";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  try {
    const data = await getAppBootstrap(request.headers);
    return data ? json(data) : json({ message: "Please sign in." }, 401);
  } catch {
    return json({ message: "Could not refresh your data. Please try again." }, 503);
  }
}
