import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dispatch(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  request: Request
): Promise<Response> {
  const auth = await getAuth();
  const handlers = toNextJsHandler(auth);
  return handlers[method](request);
}

export async function GET(request: Request): Promise<Response> {
  return dispatch("GET", request);
}

export async function POST(request: Request): Promise<Response> {
  return dispatch("POST", request);
}

export async function PUT(request: Request): Promise<Response> {
  return dispatch("PUT", request);
}

export async function PATCH(request: Request): Promise<Response> {
  return dispatch("PATCH", request);
}

export async function DELETE(request: Request): Promise<Response> {
  return dispatch("DELETE", request);
}
