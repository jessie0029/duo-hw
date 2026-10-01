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

  // Entries are end-to-end encrypted: only dates/status are readable here, so messages stay generic.
  const msgs = [];
  const rem = await u.collection('reminders').where('done', '==', false).get();
  const dueRem = rem.docs.map(d => d.data()).filter(r => r.due && r.due <= today);
  const overdue = dueRem.filter(r => r.due < today).length;
  if (dueRem.length) msgs.push({ title: 'Follow up with the duo', body: `${dueRem.length} reminder${dueRem.length > 1 ? 's' : ''} due${overdue ? ` (${overdue} overdue)` : ' today'}. Open the app to see what they owe you.`, tag: 'reminders' });
  const posts = await u.collection('posts').where('date', '==', tomorrow).get();
  if (posts.size) msgs.push({ title: 'Post scheduled tomorrow', body: `${posts.size} post${posts.size > 1 ? 's' : ''} planned for tomorrow. Check captions and approval.`, tag: 'posts' });
  const main = await u.collection('settings').doc('main').get();
  const last = (main.exists && main.data().lastBackup) || push.data().since || 0;
  if (last && Date.now() - last >= 15 * 864e5) msgs.push({ title: 'Time to back up PIANO DUO HW', body: 'Open Reminders and tap “Back up now”.', tag: 'backup' });
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
