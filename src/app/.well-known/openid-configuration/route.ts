import { NextResponse } from "next/server";
import { getConvexAuthIssuer } from "@/lib/convex-auth-token";

export const runtime = "nodejs";

export async function GET() {
  const issuer = getConvexAuthIssuer();

  return NextResponse.json({
    issuer,
    jwks_uri: `${issuer}/api/convex/jwks`,
    id_token_signing_alg_values_supported: ["RS256"],
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
  });
}
