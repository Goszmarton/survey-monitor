// Email-küldés (Gmail SMTP app-jelszóval vagy bármely SMTP-vel).
// Konfig hiányában nem hasal el, csak jelez — F0-ban a futásnak
// email nélkül is végig kell mennie.
//
// CLI-mód a workflow hiba-lépéséhez:
//   node src/email.js --failure "üzenet"

import nodemailer from "nodemailer";

function config() {
  const { SMTP_USER, SMTP_PASS, MAIL_TO, SMTP_HOST, SMTP_PORT } = process.env;
  if (!SMTP_USER || !SMTP_PASS || !MAIL_TO) return null;
  return {
    host: SMTP_HOST || "smtp.gmail.com",
    port: Number(SMTP_PORT || 465),
    secure: Number(SMTP_PORT || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: SMTP_USER,
    to: MAIL_TO,
  };
}

/** @returns {Promise<boolean>} true, ha ténylegesen elment */
export async function sendMail(subject, html) {
  const cfg = config();
  if (!cfg) return false;
  const transport = nodemailer.createTransport(cfg);
  await transport.sendMail({ from: cfg.from, to: cfg.to, subject, html });
  return true;
}

// ---- CLI-mód (hiba-email a workflow-ból) ----
if (process.argv[2] === "--failure") {
  const msg = process.argv[3] || "A monitor-futás hibával leállt.";
  const html = `<p>⚠️ ${msg}</p><p>Idő: ${new Date().toISOString()}</p>`;
  sendMail("⚠️ Monitor — a mai jelentés nem készült el", html)
    .then((sent) => console.log(sent ? "Hiba-email elküldve." : "Hiba-email kihagyva (nincs SMTP-konfig)."))
    .catch((e) => { console.error(e); process.exit(1); });
}
