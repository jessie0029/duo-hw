// Sends phone/browser push notifications for due reminders and posts scheduled tomorrow.
// Runs daily in GitHub Actions. Needs the secret FIREBASE_SERVICE_ACCOUNT (the JSON key of a Firebase service account).
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.log('FIREBASE_SERVICE_ACCOUNT not set — skipping'); process.exit(0); }
initializeApp({ credential: cert(JSON.parse(sa)) });
const db = getFirestore();

const berlin = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d); // YYYY-MM-DD
const today = berlin(new Date());
const tomorrow = berlin(new Date(Date.now() + 864e5));

const users = await db.collection('users').listDocuments();
let sent = 0;
for (const u of users) {
  const push = await u.collection('settings').doc('push').get();
  const tokens = push.exists ? (push.data().tokens || []) : [];
  if (!tokens.length) continue;

  const msgs = [];
  const rem = await u.collection('reminders').where('done', '==', false).get();
  for (const d of rem.docs) {
    const r = d.data();
    if (r.due && r.due <= today) msgs.push({ title: r.due < today ? 'Overdue: follow up with the duo' : 'Follow up with the duo today', body: r.text, tag: `rem-${d.id}` });
  }
  const posts = await u.collection('posts').where('date', '==', tomorrow).get();
  for (const d of posts.docs) {
    const p = d.data();
    msgs.push({ title: 'Post scheduled tomorrow', body: `${p.title || 'Untitled'}${p.approved ? '' : ' · not approved yet'}`, tag: `post-${d.id}` });
  }
  if (!msgs.length) continue;

  const dead = new Set();
  for (const m of msgs) {
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      webpush: { notification: { title: m.title, body: m.body, icon: 'https://jessie0029.github.io/piano-duo-hw/icons/icon-192.png', tag: m.tag }, fcmOptions: { link: 'https://jessie0029.github.io/piano-duo-hw/' } },
    });
    res.responses.forEach((r, i) => {
      if (r.success) sent++;
      else if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code || '')) dead.add(tokens[i]);
    });
  }
  if (dead.size) await push.ref.update({ tokens: tokens.filter(t => !dead.has(t)) });
}
console.log(`reminders: ${sent} notifications sent for ${today}`);
