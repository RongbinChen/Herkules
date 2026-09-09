// Email notifications via company SMTP. Configuration comes entirely from env
// vars — when they're missing, sending is silently skipped (in-app
// notifications still work), so the feature degrades gracefully until the
// operator fills in .env:
//
//   SMTP_HOST=smtp.example.com
//   SMTP_PORT=465            # 465 = implicit TLS, 587 = STARTTLS
//   SMTP_USER=noreply@example.com
//   SMTP_PASS=***
//   SMTP_FROM="Herkules CRM <noreply@example.com>"   # optional, defaults to SMTP_USER
import nodemailer from 'nodemailer';

let transporter = null;

export function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Best-effort send — never throws (a mail failure must not break scraping).
// Returns true when actually sent.
//
// cc/bcc are optional and accept the same shapes as `to` (a string, a
// comma-separated list, or an array). Empty values are dropped rather than
// passed through: nodemailer treats an empty string as an address list it has
// to parse, and some servers reject the resulting header.
export async function sendMail({ to, subject, text, html, cc, bcc }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] SMTP not configured — skipped mail to ${to}: ${subject}`);
    return false;
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      ...(cc && cc.length ? { cc } : {}),
      ...(bcc && bcc.length ? { bcc } : {}),
      subject,
      text,
      html,
    });
    console.log(`[mailer] sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[mailer] failed to ${to}: ${err.message}`);
    return false;
  }
}
