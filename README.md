# 💰 LinkPay.in — Highest Paying Link Shortener

Just2Earn se better! India mein $9-11 CPM.

## Files Structure
```
linkpay/
├── server.js          ← Backend (Node.js)
├── package.json       ← Dependencies
├── railway.json       ← Railway config
├── public/
│   └── index.html     ← Frontend (poori website)
└── README.md
```

## Railway Pe Deploy Kaise Karein

### Step 1: GitHub Pe Upload Karo
1. github.com/your-username/linkpay-in kholo
2. Saari files upload karo (server.js, package.json, railway.json, public/index.html)

### Step 2: Railway Se Connect Karo
1. railway.app pe jaao
2. "New Project" click karo
3. "Deploy from GitHub repo" select karo
4. linkpay-in repo select karo
5. Deploy button click karo

### Step 3: Environment Variable Set Karo
Railway dashboard mein:
- BASE_URL = https://your-railway-url.railway.app

### Step 4: Live Ho Jaao! 🎉

## Ad Codes Kahan Lagaen

server.js mein `generateInterstitialPage` function mein:
- Line `// Replace with your PropellerAds zone ID` ke paas apna PropellerAds code lagao
- Line `// Replace with Adsterra/Monetag banner code` ke paas banner code lagao
- Line `// Replace with PropellerAds/Monetag push notification code` ke paas push code lagao

## Admin Panel
Email: admin@linkpay.in
Password: admin123
(Deploy ke baad change zaroor karna!)

## Tech Stack
- Backend: Node.js + Express
- Database: In-memory (Railway PostgreSQL add karo baad mein)
- Frontend: Vanilla HTML/CSS/JS
- Hosting: Railway.app (Free tier)
