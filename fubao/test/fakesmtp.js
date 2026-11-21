'use strict';
// Tiny fake SMTP server (TLS) used by the tests to capture outgoing emails.
const tls = require('tls'), fs = require('fs'), os = require('os'), path = require('path'), { execSync } = require('child_process');
function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fubao-cert-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 2 -subj /CN=localhost`, { stdio: 'ignore' });
  const mails = [];
  const server = tls.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, (sock) => {
    sock.setEncoding('utf8');
    let buf = '', data = false, cur = { to: '', raw: '' }, auth = 0;
    sock.write('220 fake ready\r\n');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; const body = cur.raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\s+/g, ''); mails.push({ to: cur.to, subject: (/Subject: (.*)/.exec(cur.raw) || [])[1], text: Buffer.from(body, 'base64').toString('utf8') }); cur = { to: '', raw: '' }; sock.write('250 queued\r\n'); } else cur.raw += line + '\r\n'; continue; }
        if (/^EHLO/.test(line)) sock.write('250 hello\r\n');
        else if (line === 'AUTH LOGIN') { auth = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (auth === 1) { auth = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
        else if (auth === 2) { auth = 0; sock.write('235 ok\r\n'); }
        else if (/^MAIL FROM/.test(line)) sock.write('250 ok\r\n');
        else if (/^RCPT TO:<(.*)>/.test(line)) { cur.to = /^RCPT TO:<(.*)>/.exec(line)[1]; sock.write('250 ok\r\n'); }
        else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.end('221 bye\r\n'); }
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, mails, close: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } })));
}
module.exports = { start };
