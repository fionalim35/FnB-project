'use strict';
// Emergency owner password reset (if you cannot receive the email code):  node reset-owner.js NewPassword
const S = require('./lib/store'); const U = require('./lib/util');
S.load();
const pw = process.argv[2];
if (!pw || pw.length < 6) { console.error('Usage: node reset-owner.js <new password, min 6 characters>'); process.exit(1); }
const o = S.d().users.find((u) => u.role === 'owner');
o.passHash = U.hashPassword(pw);
for (const t of Object.keys(S.d().sessions)) if (S.d().sessions[t].userId === o.id) delete S.d().sessions[t];
S.saveNow(); console.log('Owner password updated for ' + o.phone);
