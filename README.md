# WA API — AM Hub GrabFood 🟢

WhatsApp API server untuk AM Hub GrabFood. Berfungsi sebagai chatbot notifikasi dua arah: blast pesan ke merchant, auto-reply, dan menerima trigger dari sistem AM Hub.

## 🚀 Quick Start

```bash
# 1. Clone / masuk ke folder
cd wa-api-amhub

# 2. Install dependencies
npm install

# 3. Setup environment
cp .env.example .env
# Edit .env sesuai kebutuhan (minimal ganti API_KEY)

# 4. Jalankan server
npm start

# 5. Buka QR page di browser dan scan dengan HP
# http://localhost:3001/api/qr
```

## 📡 API Endpoints

Semua endpoint kecuali `/health` dan `/api/qr` membutuhkan header:
```
X-API-Key: <isi sesuai API_KEY di .env>
```

### Status & Auth
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/api/status` | Status koneksi WA |
| `GET` | `/api/qr` | Halaman QR scan |

### Kirim Pesan
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `POST` | `/api/send` | Kirim ke 1 nomor |
| `POST` | `/api/blast` | Blast ke banyak nomor |
| `GET` | `/api/blast` | List semua blast jobs |
| `GET` | `/api/blast/:jobId/status` | Status progress blast |
| `DELETE` | `/api/blast/:jobId` | Cancel blast |
| `GET` | `/api/templates` | List template tersedia |
| `POST` | `/api/preview` | Preview render template |

### Webhook (trigger dari AM Hub)
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `POST` | `/api/webhook/campaign` | Blast campaign ke merchant |
| `POST` | `/api/webhook/visit` | Kirim visit reminder |
| `POST` | `/api/webhook/mca` | Blast MCA reminder |
| `POST` | `/api/webhook/custom` | Blast pesan custom |

### Admin
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/schedules` | List scheduled jobs |
| `POST` | `/api/schedules` | Buat schedule baru |
| `DELETE` | `/api/schedules/:id` | Hapus schedule |
| `GET` | `/api/chatbot/rules` | List chatbot rules |
| `POST` | `/api/chatbot/rules` | Buat rule baru |
| `PUT` | `/api/chatbot/rules/:id` | Update rule |
| `DELETE` | `/api/chatbot/rules/:id` | Hapus rule |
| `GET` | `/api/logs/messages` | Log pesan terkirim |
| `GET` | `/api/logs/events` | Log events WA |

---

## 📝 Contoh Request

### Kirim pesan single
```bash
curl -X POST http://localhost:3001/api/send \
  -H "X-API-Key: changeme-api-key-amhub-2024" \
  -H "Content-Type: application/json" \
  -d '{"phone": "081234567890", "message": "Halo dari AM Hub! 👋"}'
```

### Blast campaign ke merchant
```bash
curl -X POST http://localhost:3001/api/webhook/campaign \
  -H "X-API-Key: changeme-api-key-amhub-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "am_name": "Novan Sahlan",
    "campaign_name": "GMS Booster",
    "campaign_details": "Dapatkan insentif tambahan 20% untuk setiap transaksi!",
    "merchants": [
      {"phone": "081234567890", "name": "Warung Pak Budi"},
      {"phone": "089876543210", "name": "Mie Ayam Bu Sari"}
    ]
  }'
```

### Visit reminder
```bash
curl -X POST http://localhost:3001/api/webhook/visit \
  -H "X-API-Key: changeme-api-key-amhub-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_name": "Warung Pak Budi",
    "phone": "081234567890",
    "am_name": "Novan Sahlan",
    "visit_date": "Senin, 12 Agustus 2026",
    "visit_time": "10:00 WIB"
  }'
```

### MCA reminder blast
```bash
curl -X POST http://localhost:3001/api/webhook/mca \
  -H "X-API-Key: changeme-api-key-amhub-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "am_name": "Novan Sahlan",
    "merchants": [
      {"phone": "081234567890", "name": "Warung Pak Budi", "mca_limit": "50000000"},
      {"phone": "089876543210", "name": "Mie Ayam Bu Sari", "mca_limit": "25000000"}
    ]
  }'
```

### Buat scheduled blast (setiap Senin jam 9 pagi WIB)
```bash
curl -X POST http://localhost:3001/api/schedules \
  -H "X-API-Key: changeme-api-key-amhub-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly Campaign Reminder",
    "cron_expr": "0 9 * * 1",
    "type": "blast",
    "payload": {
      "template": "custom",
      "customMessage": "Selamat pagi! Jangan lupa cek performa campaign minggu ini di GrabFood 🚀",
      "recipients": [
        {"phone": "081234567890", "name": "Warung Pak Budi"}
      ]
    }
  }'
```

---

## 🏗️ Struktur Project

```
wa-api-amhub/
├── src/
│   ├── config/
│   │   ├── config.js          # Env vars & constants
│   │   └── logger.js          # Winston logger
│   ├── controllers/
│   │   ├── adminController.js  # Scheduler, chatbot rules, logs
│   │   ├── messageController.js # Send & blast
│   │   ├── statusController.js  # WA status & QR page
│   │   └── webhookController.js # AM Hub webhook handlers
│   ├── db/
│   │   └── database.js         # SQLite setup & migrations
│   ├── middlewares/
│   │   └── auth.js             # API Key validation
│   ├── routes/
│   │   ├── adminRoutes.js
│   │   ├── messageRoutes.js
│   │   ├── statusRoutes.js
│   │   └── webhookRoutes.js
│   ├── services/
│   │   ├── blastService.js     # Queue-based blast
│   │   ├── chatbotService.js   # Auto-reply logic & CRUD
│   │   ├── schedulerService.js # Cron job management
│   │   ├── templateService.js  # Template rendering
│   │   └── whatsappService.js  # Baileys WA client
│   └── app.js                 # Express app
├── templates/
│   ├── campaign.txt
│   ├── campaign_update.txt
│   ├── mca_reminder.txt
│   └── visit_reminder.txt
├── auth_info_baileys/         # WA session (gitignored)
├── data/                      # SQLite database (gitignored)
├── logs/                      # Log files (gitignored)
├── .env                       # Environment vars (gitignored)
├── .env.example
├── index.js                   # Entry point
└── package.json
```

---

## ⚠️ Penting

- **Jangan share session** di `auth_info_baileys/` — itu credential WA kamu
- **Anti-spam**: Default delay blast 3 detik per pesan. Jangan kurangi < 2 detik atau WA bisa suspend nomor
- **Satu nomor, satu session**: Gunakan nomor WA khusus untuk bot ini
- **Backup session**: Kalau `auth_info_baileys/` terhapus, perlu scan QR ulang

## 📦 Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **WA Library**: [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
- **Database**: SQLite via better-sqlite3
- **Scheduler**: node-cron (timezone Asia/Jakarta)
- **Logging**: Winston
