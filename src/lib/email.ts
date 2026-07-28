/**
 * Email provider abstraction.
 */
export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  verifyUrl?: string;
};

export type SendEmailResult = {
  ok: boolean;
  provider: string;
  previewUrl?: string;
  messageId?: string;
  error?: string;
};

function getProvider(): string {
  return (process.env.EMAIL_PROVIDER || "console").toLowerCase();
}

function getAppUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function buildVerifyUrl(token: string): string {
  return `${getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const provider = getProvider();

  if (provider === "console" || provider === "dev") {
    const previewUrl = input.verifyUrl;
    console.info("[email:console]", {
      to: input.to,
      subject: input.subject,
      previewUrl,
      text: input.text,
    });
    return { ok: true, provider: "console", previewUrl };
  }

  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      return {
        ok: false,
        provider,
        error: "RESEND_API_KEY and EMAIL_FROM are required for Resend",
      };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html ?? input.text,
        }),
      });
      const responseText = await res.text();
      if (!res.ok) {
        console.error(
          "Resend response error:",
          JSON.stringify({
            status: res.status,
            statusText: res.statusText,
            body: responseText,
          }),
        );
        return {
          ok: false,
          provider,
          error: responseText || res.statusText,
        };
      }
      let data: { id?: string } = {};
      try {
        data = JSON.parse(responseText) as { id?: string };
      } catch {
      }
      return { ok: true, provider, messageId: data.id };
    } catch (err) {
      if (err instanceof Error) {
        console.error(
          "Resend response error:",
          JSON.stringify({
            name: err.name,
            message: err.message,
            statusCode: (err as Error & { statusCode?: number }).statusCode,
          }),
        );
      } else {
        console.error(
          "Resend response error:",
          JSON.stringify({ error: String(err) }),
        );
      }
      return {
        ok: false,
        provider,
        error: err instanceof Error ? err.message : "Resend send failed",
      };
    }
  }

  if (provider === "smtp") {
    return {
      ok: false,
      provider,
      error:
        "SMTP provider stub — plug nodemailer (or similar) using SMTP_HOST/PORT/USER/PASS",
    };
  }

  return { ok: false, provider, error: `Unknown EMAIL_PROVIDER: ${provider}` };
}

export async function sendVerificationEmail(opts: {
  to: string;
  name: string;
  token: string;
}): Promise<SendEmailResult> {
  const verifyUrl = buildVerifyUrl(opts.token);
  return sendEmail({
    to: opts.to,
    subject: "Verify your Source Bridge email",
    verifyUrl,
    text: `Hi ${opts.name},\n\nVerify your Source Bridge email by opening this link:\n${verifyUrl}\n\nThis link expires in 24 hours and can only be used once.\n\nIf you did not create an account, ignore this email.`,
    html: `<p>Hi ${escapeHtml(opts.name)},</p><p>Verify your Source Bridge email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours and can only be used once.</p>`,
  });
}

export async function sendVerificationAdminAlert(opts: {
  requestId: string;
  applicantUsername: string;
  documentType: string;
  submittedAt: string;
}): Promise<SendEmailResult> {
  const to = process.env.VERIFICATION_ADMIN_EMAIL;
  if (!to) {
    return {
      ok: false,
      provider: getProvider(),
      error: "VERIFICATION_ADMIN_EMAIL is not configured",
    };
  }
  const appUrl = getAppUrl();
  const reviewUrl = `${appUrl}/admin/verifications/${encodeURIComponent(opts.requestId)}`;
  return sendEmail({
    to,
    subject: "New identity verification request pending",
    text: [
      "A new identity verification request is pending review.",
      `Applicant username: ${opts.applicantUsername}`,
      `Request ID: ${opts.requestId}`,
      `Submitted: ${opts.submittedAt}`,
      `Document type: ${opts.documentType}`,
      `Review securely: ${reviewUrl}`,
      "",
      "Do not open document links from email — review only inside the admin dashboard.",
      "Documents are not attached.",
    ].join("\n"),
  });
}

export async function sendVerificationApplicantNotice(opts: {
  to: string;
  approved: boolean;
  rejectionReason?: string;
}): Promise<SendEmailResult> {
  const outcome = opts.approved ? "approved" : "not approved";
  return sendEmail({
    to: opts.to,
    subject: "Your Source Bridge identity verification update",
    text: `Your identity verification request was ${outcome}.${opts.rejectionReason ? `\n\nReason: ${opts.rejectionReason}` : ""}\n\nOpen Source Bridge settings for details.`,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
