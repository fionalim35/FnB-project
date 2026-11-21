'use strict';
// Minimal zero-dependency SMTP client (secure connection, port 465) - works with free services such as
// Gmail (app password), Brevo, Zoho, Outlook.com SMTP. Never throws into request handlers.
const tls = require('tls');
const S = require('./store');

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();

function smtpSend(cfg, { to, subject, text }) {
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiter = null, done = false;
    const fail = (e) => { if (done) return; done = true; clearTimeout(timer); try { sock && sock.destroy(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('The email server did not respond in time')), 25000);
    const check = () => {
      const lines = buf.split('\r\n');
      if (lines.length < 2) return;
      const full = lines.slice(0, -1), last = full[full.length - 1];
      if (/^\d{3}( |$)/.test(last) && waiter) { buf = lines[lines.length - 1]; const w = waiter; waiter = null; w({ code: Number(last.slice(0, 3)), text: full.join(' | ') }); }
    };
    const read = () => new Promise((r) => { waiter = r; check(); });
    const cmd = async (line, ok) => { if (line !== null) sock.write(line + '\r\n'); const r = await read(); if (!ok.includes(r.code)) throw new Error(r.text); return r; };
    const fromEmail = cfg.fromEmail || cfg.user;
    sock = tls.connect({ host: cfg.host, port: Number(cfg.port) || 465, servername: cfg.host, rejectUnauthorized: !process.env.FUBAO_SMTP_ALLOW_SELF_SIGNED });
    sock.setEncoding('utf8');
    sock.on('data', (d) => { buf += d; check(); });
    sock.on('error', fail);
    sock.on('close', () => fail(new Error('Connection closed by the email server')));
    sock.on('secureConnect', async () => {
      try {
        await cmd(null, [220]);
        await cmd('EHLO fubao.local', [250]);
        if (cfg.user) {
          await cmd('AUTH LOGIN', [334]); await cmd(b64(cfg.user), [334]); await cmd(b64(cfg.pass || ''), [235]);
        }
        await cmd(`MAIL FROM:<${fromEmail}>`, [250]);
        await cmd(`RCPT TO:<${to}>`, [250, 251]);
        await cmd('DATA', [354]);
        const msg = [
          `From: ${header(cfg.fromName || 'Fubao Beauty Centre')} <${fromEmail}>`, `To: <${to}>`, `Subject: ${header(subject)}`,
          `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@fubao.local>`,
          'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text)),
        ].join('\r\n');
        await cmd(msg + '\r\n.', [250]);
        sock.write('QUIT\r\n');
        done = true; clearTimeout(timer); sock.end(); resolve();
      } catch (e) { fail(e); }
    });
  });
}

const configured = () => { const st = S.d().settings; return !!(st.emailEnabled && st.smtp && st.smtp.host && st.smtp.user && st.smtp.pass); };
function log(entry) { const d = S.d(); d.mailLog = d.mailLog || []; d.mailLog.unshift({ at: Date.now(), ...entry }); d.mailLog.length = Math.min(d.mailLog.length, 40); S.save(); }

/** Send an email. Resolves {ok, error}; never rejects. Skips quietly when email is not set up. */
async function send(to, subject, text, { force = false } = {}) {
  const st = S.d().settings;
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: 'No valid email address' };
  if (!force && !configured()) return { ok: false, error: 'Email is not set up' };
  if (!st.smtp || !st.smtp.host || !st.smtp.user || !st.smtp.pass) return { ok: false, error: 'Please fill in the email server details first' };
  const sig = `\n\n— ${st.studioName}\n${st.address}\n${st.phone}`;
  try { await smtpSend({ ...st.smtp }, { to, subject, text: text + sig }); log({ to, subject, ok: true }); return { ok: true }; }
  catch (e) { log({ to, subject, ok: false, error: e.message }); return { ok: false, error: e.message }; }
}
module.exports = { send, configured, smtpSend };
