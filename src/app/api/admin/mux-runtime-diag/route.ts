import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/auth";
import { createMuxDirectUpload, isMuxConfigured } from "@/lib/mux-stories";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY admin-only Mux runtime diagnostic.
 * Returns only safe PASS/FAIL fields — never token values or Authorization headers.
 * Remove this route after Production verification.
 */
export async function POST() {
  const requestId = randomBytes(6).toString("hex");
  try {
    await requireAdmin();

    const idLoaded = Boolean(process.env.MUX_TOKEN_ID?.trim());
    const secretLoaded = Boolean(process.env.MUX_TOKEN_SECRET?.trim());
    const webhookLoaded = Boolean(process.env.MUX_WEBHOOK_SECRET?.trim());
    // Lengths of the *runtime* values (not CLI-redacted placeholders).
    const idLen = (process.env.MUX_TOKEN_ID || "").trim().length;
    const secretLen = (process.env.MUX_TOKEN_SECRET || "").trim().length;
    const webhookLen = (process.env.MUX_WEBHOOK_SECRET || "").trim().length;

    if (!isMuxConfigured()) {
      return Response.json({
        requestId,
        authenticated: "FAIL",
        httpStatus: null,
        reason: "MUX_NOT_CONFIGURED_AT_RUNTIME",
        env: {
          MUX_TOKEN_ID_loaded: idLoaded,
          MUX_TOKEN_SECRET_loaded: secretLoaded,
          MUX_WEBHOOK_SECRET_loaded: webhookLoaded,
          MUX_TOKEN_ID_runtimeLength: idLen,
          MUX_TOKEN_SECRET_runtimeLength: secretLen,
          MUX_WEBHOOK_SECRET_runtimeLength: webhookLen,
        },
      });
    }

    const tokenId = (process.env.MUX_TOKEN_ID || "").trim();
    const tokenSecret = (process.env.MUX_TOKEN_SECRET || "").trim();
    const basic = Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64");

    let whoamiHttp = 0;
    let organization: string | null = null;
    let environment: string | null = null;
    let permissions: unknown = null;
    let safeError: string | null = null;

    try {
      const res = await fetch("https://api.mux.com/system/v1/whoami", {
        headers: { Authorization: `Basic ${basic}` },
        cache: "no-store",
      });
      whoamiHttp = res.status;
      const body = (await res.json().catch(() => ({}))) as {
        data?: {
          id?: string;
          organization?: { id?: string; name?: string };
          environment?: { id?: string; name?: string };
          permissions?: unknown;
        };
        error?: { type?: string; messages?: string[] };
      };
      if (res.ok) {
        organization =
          body.data?.organization?.name ||
          body.data?.organization?.id ||
          body.data?.id ||
          null;
        environment =
          body.data?.environment?.name || body.data?.environment?.id || null;
        permissions = body.data?.permissions ?? null;
      } else {
        safeError =
          body.error?.type ||
          body.error?.messages?.[0] ||
          `HTTP ${res.status}`;
      }
    } catch (err) {
      safeError =
        err instanceof Error ? err.message.slice(0, 160) : "whoami_fetch_failed";
    }

    const authPass = whoamiHttp >= 200 && whoamiHttp < 300;

    let directUpload: {
      pass: "PASS" | "FAIL";
      httpStatus: number | null;
      uploadIdReturned: boolean;
      uploadUrlReturned: boolean;
      cleanedUp: boolean;
      safeError?: string;
    } = {
      pass: "FAIL",
      httpStatus: null,
      uploadIdReturned: false,
      uploadUrlReturned: false,
      cleanedUp: false,
    };

    if (authPass) {
      try {
        const upload = await createMuxDirectUpload({
          uploadSessionId: `diag_${requestId}`,
          corsOrigin: "*",
        });
        directUpload = {
          pass: "PASS",
          httpStatus: 201,
          uploadIdReturned: Boolean(upload.uploadId),
          uploadUrlReturned: Boolean(upload.uploadUrl),
          cleanedUp: false,
        };
        try {
          const Mux = (await import("@mux/mux-node")).default;
          const mux = new Mux({ tokenId, tokenSecret });
          await mux.video.uploads.cancel(upload.uploadId);
          directUpload.cleanedUp = true;
        } catch {
          directUpload.cleanedUp = false;
        }
      } catch (err) {
        const status = (err as { status?: number }).status ?? null;
        directUpload = {
          pass: "FAIL",
          httpStatus: status,
          uploadIdReturned: false,
          uploadUrlReturned: false,
          cleanedUp: false,
          safeError:
            err instanceof Error ? err.message.slice(0, 200) : "upload_failed",
        };
      }
    }

    return Response.json({
      requestId,
      authenticated: authPass ? "PASS" : "FAIL",
      httpStatus: whoamiHttp || null,
      organization,
      environment,
      permissions,
      safeError,
      env: {
        MUX_TOKEN_ID_loaded: idLoaded,
        MUX_TOKEN_SECRET_loaded: secretLoaded,
        MUX_WEBHOOK_SECRET_loaded: webhookLoaded,
        MUX_TOKEN_ID_runtimeLength: idLen,
        MUX_TOKEN_SECRET_runtimeLength: secretLen,
        MUX_WEBHOOK_SECRET_runtimeLength: webhookLen,
        note: "runtimeLength is from process.env inside Production — not CLI redaction",
      },
      directUpload,
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return jsonError(
      status === 401
        ? "Sign in required"
        : status === 403
          ? "Admin only"
          : "Diagnostic failed",
      status,
      { requestId },
    );
  }
}
