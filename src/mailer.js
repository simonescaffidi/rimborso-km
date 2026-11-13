// Invio email via API Brevo (standard stack-standard di Simone). Mai SMTP: gli IP Railway sono in blacklist.
// Env: BREVO_API_KEY, MAIL_FROM_EMAIL, MAIL_FROM_NAME. Senza BREVO_API_KEY non invia e lo segnala.
// Interfaccia invariata: invia({ to, cc, replyTo, subject, text, html, attachments }) con allegati { filename, content }
// (Buffer o stringa); se Brevo risponde con errore lancia un'eccezione, come faceva il trasporto SMTP.

let transport = null;
function configurato() { return !!process.env.BREVO_API_KEY; }

// Per i test: permette di sostituire il trasporto (oggetto con sendMail(messaggio))
function _setTransport(t) { transport = t; }

const indirizzi = (v) => [].concat(v || []).flatMap((x) => String(x).split(/[,;]/)).map((s) => s.trim()).filter(Boolean).map((email) => ({ email }));

async function inviaBrevo({ to, cc, replyTo, subject, text, html, attachments }) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM_EMAIL || 'info@simonescaffidi.it', name: process.env.MAIL_FROM_NAME || 'Rimborso Km' },
      to: indirizzi(to),
      cc: indirizzi(cc).length ? indirizzi(cc) : undefined,
      replyTo: replyTo ? { email: replyTo } : undefined,
      subject,
      htmlContent: html || undefined,
      textContent: text || (html ? undefined : ' '),
      attachment: attachments && attachments.length
        ? attachments.map((a) => ({ name: a.filename || a.name, content: a.base64 || Buffer.from(a.content || '').toString('base64') }))
        : undefined,
    }),
  });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${corpo.slice(0, 300)}`);
  let id = null; try { id = JSON.parse(corpo).messageId || null; } catch (_) { /* risposta senza JSON */ }
  return { inviata: true, id };
}

async function invia(messaggio) {
  if (transport) { const info = await transport.sendMail(messaggio); return { inviata: true, id: info && info.messageId }; }
  if (!configurato()) return { inviata: false, motivo: 'non_configurato' };
  return inviaBrevo(messaggio);
}

module.exports = { invia, configurato: () => configurato() || !!transport, _setTransport };
