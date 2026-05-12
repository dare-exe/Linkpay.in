const express = require('express');
const path = require('path');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── IN-MEMORY DATABASE (Railway PostgreSQL se replace ho jaayega) ──
const db = {
  users: [
    { id: 1, name: 'Admin', email: 'admin@linkpay.in', password: 'admin123', role: 'admin', balance: 0, totalEarned: 0, referralCode: 'ADMIN001', referredBy: null, createdAt: new Date() },
  ],
  links: [],
  clicks: [],
  withdrawals: [],
  settings: {
    publisherRate: 0.80, // 80% publisher ko
    platformRate: 0.20,  // 20% platform ko
    cpmRate: 10.00,      // $10 per 1000 views base
    minWithdraw: 1.00,
    propellerAdsZoneId: 'YOUR_ZONE_ID',
    monetagZoneId: 'YOUR_MONETAG_ID',
    adsterraBannerId: 'YOUR_ADSTERRA_ID',
  }
};

// ── HELPERS ──
function generateCode(len = 6) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}
function findUser(email) { return db.users.find(u => u.email === email); }
function findUserById(id) { return db.users.find(u => u.id === id); }
function findLink(code) { return db.links.find(l => l.code === code); }

// ── AUTH ROUTES ──
app.post('/api/register', (req, res) => {
  const { name, email, password, referralCode } = req.body;
  if (!name || !email || !password) return res.json({ success: false, message: 'Sab fields bharo' });
  if (findUser(email)) return res.json({ success: false, message: 'Email already registered hai' });

  const referredBy = referralCode ? db.users.find(u => u.referralCode === referralCode)?.id : null;
  const user = {
    id: db.users.length + 1, name, email, password,
    role: 'publisher', balance: 0, totalEarned: 0,
    totalClicks: 0, totalLinks: 0,
    referralCode: generateCode(8).toUpperCase(),
    referredBy, createdAt: new Date()
  };
  db.users.push(user);
  res.json({ success: true, user: { ...user, password: undefined } });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = findUser(email);
  if (!user || user.password !== password) return res.json({ success: false, message: 'Email ya password galat hai' });
  res.json({ success: true, user: { ...user, password: undefined } });
});

// ── LINK ROUTES ──
app.post('/api/links/create', (req, res) => {
  const { userId, originalUrl, customAlias } = req.body;
  if (!userId || !originalUrl) return res.json({ success: false, message: 'URL required hai' });

  const code = customAlias || generateCode(6);
  if (findLink(code)) return res.json({ success: false, message: 'Yeh alias already use ho raha hai' });

  const link = {
    id: db.links.length + 1, userId: parseInt(userId),
    code, originalUrl,
    shortUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/${code}`,
    clicks: 0, earnings: 0, status: 'active',
    createdAt: new Date()
  };
  db.links.push(link);

  const user = findUserById(parseInt(userId));
  if (user) user.totalLinks = (user.totalLinks || 0) + 1;

  res.json({ success: true, link });
});

app.get('/api/links/user/:userId', (req, res) => {
  const links = db.links.filter(l => l.userId === parseInt(req.params.userId));
  res.json({ success: true, links });
});

app.delete('/api/links/:id', (req, res) => {
  const idx = db.links.findIndex(l => l.id === parseInt(req.params.id));
  if (idx === -1) return res.json({ success: false, message: 'Link nahi mila' });
  db.links.splice(idx, 1);
  res.json({ success: true });
});

// ── REDIRECT ROUTE (Main earning route) ──
app.get('/:code', (req, res) => {
  const { code } = req.params;
  if (code.startsWith('api') || code === 'admin' || code === 'dashboard') return res.redirect('/');

  const link = findLink(code);
  if (!link) return res.redirect('/?error=link_not_found');

  // Track click
  const clickData = {
    id: db.clicks.length + 1, linkId: link.id,
    userId: link.userId, ip: req.ip,
    country: req.headers['cf-ipcountry'] || 'IN',
    userAgent: req.headers['user-agent'],
    createdAt: new Date()
  };
  db.clicks.push(clickData);

  // Calculate earnings
  const cpmByCountry = { US: 14, GB: 12, CA: 11, AU: 10, DE: 8, FR: 7, IN: 9, DEFAULT: 6 };
  const country = clickData.country;
  const cpm = cpmByCountry[country] || cpmByCountry.DEFAULT;
  const clickEarning = cpm / 1000;

  // Update link earnings
  link.clicks += 1;
  link.earnings = parseFloat((link.earnings + clickEarning).toFixed(4));

  // Update publisher balance (80%)
  const publisher = findUserById(link.userId);
  if (publisher) {
    const publisherEarning = clickEarning * db.settings.publisherRate;
    publisher.balance = parseFloat((publisher.balance + publisherEarning).toFixed(4));
    publisher.totalEarned = parseFloat((publisher.totalEarned + publisherEarning).toFixed(4));
    publisher.totalClicks = (publisher.totalClicks || 0) + 1;

    // Referral earning (10%)
    if (publisher.referredBy) {
      const referrer = findUserById(publisher.referredBy);
      if (referrer) {
        const refEarning = publisherEarning * 0.10;
        referrer.balance = parseFloat((referrer.balance + refEarning).toFixed(4));
        referrer.totalEarned = parseFloat((referrer.totalEarned + refEarning).toFixed(4));
      }
    }
  }

  // Serve interstitial page
  res.send(generateInterstitialPage(link.originalUrl, db.settings));
});

// ── EARNINGS ROUTES ──
app.get('/api/earnings/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = findUserById(userId);
  if (!user) return res.json({ success: false });

  const userLinks = db.links.filter(l => l.userId === userId);
  const userClicks = db.clicks.filter(c => c.userId === userId);

  // Last 7 days earnings
  const dailyEarnings = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    const dayClicks = userClicks.filter(c => c.createdAt.toISOString().slice(0, 10) === dateStr);
    const dayEarning = dayClicks.length * 0.009;
    dailyEarnings.push({ date: dateStr, clicks: dayClicks.length, amount: parseFloat(dayEarning.toFixed(3)) });
  }

  res.json({
    success: true,
    balance: user.balance,
    totalEarned: user.totalEarned,
    totalClicks: user.totalClicks || 0,
    totalLinks: userLinks.length,
    dailyEarnings
  });
});

// ── WITHDRAWAL ROUTES ──
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, account } = req.body;
  const user = findUserById(parseInt(userId));
  if (!user) return res.json({ success: false, message: 'User nahi mila' });
  if (amount < db.settings.minWithdraw) return res.json({ success: false, message: `Minimum withdrawal $${db.settings.minWithdraw} hai` });
  if (user.balance < amount) return res.json({ success: false, message: 'Balance kam hai' });

  user.balance = parseFloat((user.balance - amount).toFixed(4));
  const withdrawal = { id: db.withdrawals.length + 1, userId: user.id, amount, method, account, status: 'pending', createdAt: new Date() };
  db.withdrawals.push(withdrawal);
  res.json({ success: true, withdrawal });
});

app.get('/api/withdrawals/:userId', (req, res) => {
  const withdrawals = db.withdrawals.filter(w => w.userId === parseInt(req.params.userId));
  res.json({ success: true, withdrawals });
});

// ── ADMIN ROUTES ──
app.get('/api/admin/stats', (req, res) => {
  const totalUsers = db.users.filter(u => u.role === 'publisher').length;
  const totalLinks = db.links.length;
  const totalClicks = db.clicks.length;
  const totalEarned = db.users.reduce((s, u) => s + (u.totalEarned || 0), 0);
  const pendingWithdrawals = db.withdrawals.filter(w => w.status === 'pending').length;
  res.json({ success: true, totalUsers, totalLinks, totalClicks, totalEarned: totalEarned.toFixed(2), pendingWithdrawals });
});

app.get('/api/admin/users', (req, res) => {
  const users = db.users.filter(u => u.role === 'publisher').map(u => ({ ...u, password: undefined }));
  res.json({ success: true, users });
});

app.post('/api/admin/withdraw/approve/:id', (req, res) => {
  const w = db.withdrawals.find(w => w.id === parseInt(req.params.id));
  if (w) w.status = 'paid';
  res.json({ success: true });
});

// ── REFERRAL ──
app.get('/api/referrals/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const referrals = db.users.filter(u => u.referredBy === userId).map(u => ({
    name: u.name, joined: u.createdAt, totalEarned: u.totalEarned || 0,
    yourCut: parseFloat(((u.totalEarned || 0) * 0.10).toFixed(3))
  }));
  res.json({ success: true, referrals });
});

// ── INTERSTITIAL PAGE GENERATOR ──
function generateInterstitialPage(originalUrl, settings) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LinkPay — Please Wait</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0e1a;color:#f1f5f9;font-family:'DM Sans',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center}
  .logo{font-family:'Syne',sans-serif;font-weight:800;font-size:24px;color:#f59e0b;position:fixed;top:20px;left:24px}
  .ad-label{position:fixed;top:20px;right:24px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px}
  .ad-container{width:100%;max-width:728px;min-height:90px;background:#1e293b;border:1px solid #334155;border-radius:12px;margin-bottom:32px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
  .ad-placeholder{color:#475569;font-size:13px}
  .countdown-wrap{margin-bottom:24px}
  .count-num{font-family:'Syne',sans-serif;font-size:64px;font-weight:800;color:#f59e0b;line-height:1;animation:pop 1s ease infinite}
  @keyframes pop{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
  .count-label{font-size:14px;color:#94a3b8;margin-top:8px}
  .dest{font-size:13px;color:#64748b;margin-bottom:32px;background:#1e293b;padding:8px 20px;border-radius:8px;max-width:500px}
  .dest span{color:#f59e0b}
  .skip-btn{padding:14px 40px;border-radius:12px;font-size:15px;font-weight:600;border:none;cursor:pointer;transition:all 0.2s;font-family:'DM Sans',sans-serif}
  .skip-disabled{background:#1e293b;color:#475569;cursor:not-allowed}
  .skip-active{background:#f59e0b;color:#000;animation:glow 1.5s infinite}
  @keyframes glow{0%,100%{box-shadow:0 0 20px #f59e0b44}50%{box-shadow:0 0 40px #f59e0b88}}
  .ad-bottom{width:100%;max-width:728px;min-height:90px;background:#1e293b;border:1px solid #334155;border-radius:12px;margin-top:32px;display:flex;align-items:center;justify-content:center}
  .powered{position:fixed;bottom:16px;font-size:11px;color:#334155}
  .powered a{color:#f59e0b;text-decoration:none}
</style>
</head>
<body>

<div class="logo">LinkPay</div>
<div class="ad-label">Advertisement</div>

<!-- AD 1: PropellerAds Popunder (fires on page load) -->
<script>
(function(){
  // Replace with your PropellerAds zone ID
  // (function(d,z,s){s.src='https://'+d+'/401/'+z;try{document.head.appendChild(s)}catch(e){document.write(s.outerHTML)}})(YOUR_PROPELLER_DOMAIN, YOUR_ZONE_ID, document.createElement('script'));
  console.log('Popunder ad slot - Add PropellerAds code here');
})();
</script>

<!-- AD 2: Top Banner -->
<div class="ad-container">
  <!-- Replace with Adsterra/Monetag banner code -->
  <span class="ad-placeholder">📢 Banner Ad (728×90) — Add Adsterra code here</span>
</div>

<div class="dest">
  Aap ja rahe hain: <span id="destUrl">${originalUrl.slice(0, 50)}${originalUrl.length > 50 ? '...' : ''}</span>
</div>

<div class="countdown-wrap">
  <div class="count-num" id="countNum">5</div>
  <div class="count-label">seconds mein skip kar sakte ho</div>
</div>

<button class="skip-btn skip-disabled" id="skipBtn" disabled>
  Skip Ad & Continue →
</button>

<!-- AD 3: Bottom Banner -->
<div class="ad-bottom">
  <!-- Replace with Monetag banner code -->
  <span class="ad-placeholder">📢 Banner Ad (728×90) — Add Monetag code here</span>
</div>

<!-- AD 4: Push Notification -->
<script>
// Replace with PropellerAds/Monetag push notification code
// (function(d,z,s){...})(...);
console.log('Push notification slot - Add code here');
</script>

<div class="powered">Powered by <a href="/">LinkPay.in</a> — Shorten. Share. Earn.</div>

<script>
  let count = 5;
  const btn = document.getElementById('skipBtn');
  const num = document.getElementById('countNum');
  
  const timer = setInterval(() => {
    count--;
    num.textContent = count;
    if(count <= 0){
      clearInterval(timer);
      btn.disabled = false;
      btn.className = 'skip-btn skip-active';
      btn.textContent = '✅ Continue to Destination →';
    }
  }, 1000);

  btn.addEventListener('click', () => {
    window.location.href = '${originalUrl}';
  });
</script>

</body>
</html>`;
}

// ── SERVE FRONTEND ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ LinkPay server running on port ${PORT}`));
