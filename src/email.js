// Email-küldés (Gmail SMTP app-jelszóval vagy bármely SMTP-vel).
// Konfig hiányában nem hasal el, csak jelez — F0-ban a futásnak
// email nélkül is végig kell mennie.
//
// CLI-mód a workflow hiba-lépéséhez:
//   node src/email.js --failure "üzenet"

import nodemailer from "nodemailer";

/**
 * MAIL_TO guard: a nyers secretet tisztított címzett-listává bontja, hogy a néma
 * kézbesítési hibák (CLAUDE.md 2) láthatóvá váljanak. A nodemailer csak a VESSZŐS
 * listát érti — a pontosvesszőt helyreállítjuk (de jelezzük), a záró whitespace-t
 * és üres tagokat eldobjuk, a @-nélküli (gyanús) címet MEGTARTJUK, de jelezzük
 * (nem néma dobás). @returns {{recipients: string[], warnings: string[]}}
 */
export function parseRecipients(raw) {
  const warnings = [];
  if (raw == null) return { recipients: [], warnings: ["MAIL_TO nincs beállítva"] };
  let s = String(raw);
  if (s.includes(";")) {
    warnings.push("MAIL_TO pontosvesszőt tartalmaz — a nodemailer csak a vesszős listát érti; a pontosvesszőt is elválasztóként kezelem");
    s = s.replace(/;/g, ",");
  }
  const recipients = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (recipients.length === 0) {
    warnings.push("MAIL_TO üres a szétbontás után — nincs címzett");
  }
  for (const r of recipients) {
    if (!r.includes("@")) warnings.push(`gyanús címzett (nincs @): ${r}`);
  }
  return { recipients, warnings };
}

function config() {
  const { SMTP_USER, SMTP_PASS, MAIL_TO, SMTP_HOST, SMTP_PORT } = process.env;
  if (!SMTP_USER || !SMTP_PASS || !MAIL_TO) return null;
  const { recipients, warnings } = parseRecipients(MAIL_TO);
  for (const w of warnings) console.warn(`MAIL_TO guard: ${w}`);
  if (recipients.length === 0) return null; // nincs kézbesíthető címzett → mint a hiányzó konfig
  return {
    host: SMTP_HOST || "smtp.gmail.com",
    port: Number(SMTP_PORT || 465),
    secure: Number(SMTP_PORT || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: SMTP_USER,
    to: recipients, // tömb: a nodemailer több címzettet is elfogad
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
