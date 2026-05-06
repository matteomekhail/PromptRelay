import { NextResponse } from "next/server";
import { getConvexAuthJwks } from "@/lib/convex-auth-token";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getConvexAuthJwks());
}
