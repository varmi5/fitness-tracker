import { authConfigured, getAuth } from "../../../../lib/runtime";

function handler(request: Request) {
  if (!authConfigured()) return Response.json({ message: "Setup is not configured." }, { status: 503 });
  return getAuth().handler(request);
}

export const GET = handler;
export const POST = handler;
