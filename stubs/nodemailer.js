// Cloudflare Workers build: SMTP sign-in mail isn't supported there — use Resend (RESEND_API_KEY + RESEND_FROM).
export default { createTransport() { throw new Error('SMTP is not available on Cloudflare Workers; set RESEND_API_KEY and RESEND_FROM instead.'); } };
