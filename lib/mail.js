// Sends the sign-in code. Resend (RESEND_API_KEY + RESEND_FROM) or SMTP (SMTP_HOST...). Neither => dev: log to console.
export function mailProvider() {
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_FROM) return 'smtp';
  return null;
}
let smtp;
export async function sendCode(email, code) {
  const subject = `Your TTu sign-in code: ${code}`;
  const text = `Your TTu sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email.\n\nTTu by Hadtah · hadtah.com`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;color:#064e3b">
  <div style="background:linear-gradient(135deg,#2dd4bf,#059669);color:#fff;padding:18px 22px;border-radius:14px 14px 0 0;font-size:22px;font-weight:700">TTu</div>
  <div style="border:1px solid #ccfbf1;border-top:0;padding:22px;border-radius:0 0 14px 14px">
  <p>Your sign-in code is</p><p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:8px 0">${code}</p>
  <p style="color:#4b5563;font-size:13px">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
  <p style="color:#4b5563;font-size:12px">TTu by Hadtah · hadtah.com</p></div></div>`;
  const p = mailProvider();
  if (p === 'resend') {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [email], subject, text, html }) });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return { delivered: true };
  }
  if (p === 'smtp') {
    const nodemailer = (await import('nodemailer')).default;
    smtp ||= nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '') === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
    await smtp.sendMail({ from: process.env.SMTP_FROM, to: email, subject, text, html });
    return { delivered: true };
  }
  console.log(`\n[dev-mail] No email provider configured. Sign-in code for ${email}: ${code}\n`);
  return { delivered: false };
}
