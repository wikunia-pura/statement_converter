/**
 * SMTP transport for the Mailing module. Credentials come from the machine-local
 * settings (home.pl by default) — never from the shared Supabase project — so
 * each install sends from its own mailbox.
 */

import nodemailer, { Transporter } from 'nodemailer';
import { MailingAttachment, MailingSmtpConfig } from '../../shared/types';

export type SmtpCredentials = MailingSmtpConfig & { pass: string };

/** Everything missing before a send can even be attempted, in Polish. */
export function validateSmtp(config: SmtpCredentials): string | null {
  if (!config.host.trim()) return 'Brak serwera SMTP (Ustawienia → Skrzynka do wysyłki).';
  if (!config.user.trim()) return 'Brak adresu e-mail nadawcy (Ustawienia → Skrzynka do wysyłki).';
  if (!config.pass) return 'Brak hasła do skrzynki (Ustawienia → Skrzynka do wysyłki).';
  if (!Number.isFinite(config.port) || config.port <= 0) return 'Nieprawidłowy port SMTP.';
  return null;
}

function createTransport(config: SmtpCredentials): Transporter {
  return nodemailer.createTransport({
    host: config.host.trim(),
    port: config.port,
    secure: config.secure,
    auth: { user: config.user.trim(), pass: config.pass },
  });
}

/** The From header: display name when configured, bare address otherwise. */
function formatFrom(config: SmtpCredentials): string {
  const name = config.fromName.trim();
  const address = config.user.trim();
  return name ? `"${name.replace(/"/g, '')}" <${address}>` : address;
}

/**
 * Check the credentials without sending anything — `verify()` opens the
 * connection and authenticates, which is exactly what the "Testuj połączenie"
 * button in Settings needs to answer.
 */
export async function verifySmtp(
  config: SmtpCredentials,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const invalid = validateSmtp(config);
  if (invalid) return { ok: false, error: invalid };
  const transport = createTransport(config);
  try {
    await transport.verify();
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    transport.close();
  }
}

/** An image the body references by `cid:` — the letterhead logo. */
export interface InlineImage {
  cid: string;
  fileName: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: MailingAttachment[];
  inlineImages?: InlineImage[];
}

/**
 * Sender bound to one set of credentials, reused across every community in a
 * send so a batch opens a single SMTP connection instead of one per message.
 */
export class MailingSender {
  private transport: Transporter;

  constructor(private config: SmtpCredentials) {
    this.transport = createTransport(config);
  }

  get from(): string {
    return this.config.user.trim();
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transport.sendMail({
      from: formatFrom(this.config),
      to: mail.to,
      // SMTP leaves no copy in the mailbox's Sent folder; a self-BCC is the
      // pragmatic way to keep a record where the user actually reads mail.
      ...(this.config.bccSelf ? { bcc: this.config.user.trim() } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [
        ...mail.attachments.map((a) => ({ filename: a.fileName, path: a.filePath })),
        // Inline first-class parts, not downloads: `cid` plus an inline
        // disposition is what keeps the logo out of the recipient's attachment
        // list while still rendering it in the body.
        ...(mail.inlineImages ?? []).map((image) => ({
          filename: image.fileName,
          content: image.content,
          contentType: image.contentType,
          cid: image.cid,
          contentDisposition: 'inline' as const,
        })),
      ],
    });
  }

  close(): void {
    this.transport.close();
  }
}
