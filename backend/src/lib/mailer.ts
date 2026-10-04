import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config.js';

export interface Mailer {
  readonly enabled: boolean;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export function createMailer(config: AppConfig): Mailer {
  if (!config.smtp) {
    return { enabled: false, async send() {} };
  }
  const smtp = config.smtp;
  const transport: Transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return {
    enabled: true,
    async send(message) {
      await transport.sendMail({ from: smtp.from, ...message });
    },
  };
}
