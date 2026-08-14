// =================================================================
// KONFIGURASI UTAMA WA API
// =================================================================
var WA_CONFIG = {
  WA_API_URL: "https://wa-api-amhub.onrender.com", // URL Render WA API Anda
  WA_API_KEY: "changeme-api-key-amhub",                      // API Key dari .env

  SHEET_NAME: "Campaign",
  KONTAK_SHEET_NAME: "Kontak AM", // Nama Sheet tempat daftar kontak (opsional)
  HEADER_ROW_INDEX: 3, // Baris ke-4 di Google Sheets (0-based index: 3)
  DEFAULT_ADMIN_PHONE: "081298918270", // Nomor Penerima Rekap Group WA / Admin jika kontak AM tidak ada
  MAX_CHAR_LIMIT: 3000, // Limit Karakter per Pesan untuk Auto-Splitter

  // Fallback Buku Kontak (Digunakan HANYA JIKA sheet "Kontak AM" tidak dibuat)
  BUKU_KONTAK_FALLBACK: {
    "Aldo": "081234567891",   
    "Muhamad Novan Nurulfattah Sahlan": "081298918270",  
    "Budi": "081122334455"    
  }
};

/**
 * =================================================================
 * FUNGSI UTAMA (ENTRY POINT TRIGGER 1X SEHARI)
 * =================================================================
 * Dipasang pada Trigger Time-Driven Google Apps Script (misal jam 11:30 WIB)
 */
function jalankanNotifikasiHarianWA() {
  const todayStr = getTodayDateString();
  const scriptProps = PropertiesService.getScriptProperties();
  const lastRunDate = scriptProps.getProperty("LAST_RUN_DATE");

  // STRICT LOCK: Cegah pengiriman kedua pada hari yang sama
  if (lastRunDate === todayStr) {
    Logger.log(`[SKIP] Notifikasi harian untuk tanggal ${todayStr} sudah pernah terkirim hari ini.`);
    return;
  }

  Logger.log(`[START] Memulai pemrosesan notifikasi GMS & Local Campaign untuk ${todayStr}...`);
  const success = prosesNotifikasiGmsDanLocal(todayStr);

  if (success) {
    // Simpan tanggal eksekusi ke ScriptProperties agar tidak terulang hari ini
    scriptProps.setProperty("LAST_RUN_DATE", todayStr);
    Logger.log(`[COMPLETED] Notifikasi harian tanggal ${todayStr} sukses terkirim dan terkunci.`);
  } else {
    Logger.log(`[INFO] Tidak ada event Opt-In/Opt-Out baru hari ini atau pengiriman dilewati.`);
  }
}

/**
 * FUNGSI UTAMA TESTING (Bypass Lock Tanggal)
 * Gunakan fungsi ini jika ingin mengetes pengiriman tanpa terhalang kuncian tanggal.
 */
function forceRunNotifikasiHarianWA() {
  const todayStr = getTodayDateString();
  Logger.log(`[FORCE START] Memulai pengujian notifikasi untuk ${todayStr}...`);
  prosesNotifikasiGmsDanLocal(todayStr);
}

/**
 * FUNGSI UTAMA RESET LOCK
 * Gunakan fungsi ini untuk membuka kunci jika ingin mengirim ulang di hari yang sama.
 */
function resetLockPengirimanHariIni() {
  PropertiesService.getScriptProperties().deleteProperty("LAST_RUN_DATE");
  Logger.log("[RESET] Kunci pengiriman harian berhasil dihapus.");
}


/**
 * =================================================================
 * LOGIKA PEMROSESAN DATA & PENGIRIMAN PESAN
 * =================================================================
 */
function prosesNotifikasiGmsDanLocal(todayStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(WA_CONFIG.SHEET_NAME);
  
  if (!sheet) {
    Logger.log(`[ERROR] Sheet "${WA_CONFIG.SHEET_NAME}" tidak ditemukan!`);
    return false;
  }

  // 0. AMBIL KONTAK AM SECARA DINAMIS DARI SHEET ATU FALLBACK
  const bukuKontakAM = muatBukuKontakAM(ss);

  const data = sheet.getDataRange().getValues();
  if (data.length <= WA_CONFIG.HEADER_ROW_INDEX) {
    Logger.log("[ERROR] Data sheet kosong atau tidak ditemukan header di baris ke-4.");
    return false;
  }

  // 1. DYNAMIC HEADER INDEX FINDER
  const headers = data[WA_CONFIG.HEADER_ROW_INDEX];
  const cols = findHeaderIndexes(headers);

  if (cols.amName === -1 || cols.mexName === -1) {
    Logger.log("[ERROR] Kolom wajib (AM Name / Mex Name) tidak ditemukan di Header Row 4.");
    return false;
  }

  // Objek penampung data per AM
  let amData = {};
  let totalGmsIn = 0;
  let totalGmsOut = 0;
  let totalLocalIn = 0;

  let stampsToUpdate = []; // Menampung antrean penulisan stempel

  // 2. SCANNING BARIS DEMI BARIS (Mulai Row 5)
  for (let r = WA_CONFIG.HEADER_ROW_INDEX + 1; r < data.length; r++) {
    let row = data[r];
    let mexName = String(row[cols.mexName] || "").trim();
    if (!mexName) continue; // Skip jika nama merchant kosong

    let amName = String(row[cols.amName] || "AM Hub Team").trim();
    let mexId = cols.mexId !== -1 ? String(row[cols.mexId] || "").trim() : "-";

    // Inisialisasi struktur AM jika belum ada
    if (!amData[amName]) {
      amData[amName] = {
        amName: amName,
        phone: bukuKontakAM[amName] || WA_CONFIG.DEFAULT_ADMIN_PHONE,
        gmsIn: [],
        gmsOut: [],
        localIn: []
      };
    }

    // A. CEK GMS OPT-IN
    if (cols.gmsDateIn !== -1 && cols.stempelGmsIn !== -1) {
      let dateInVal = row[cols.gmsDateIn];
      let stempelInStr = formatUntukStempel(row[cols.stempelGmsIn]);
      let pkgInName = cols.gmsPkgIn !== -1 ? String(row[cols.gmsPkgIn] || "GMS Package").trim() : "GMS Package";

      // Hanya kirim jika ada tanggal hari ini/kemarin DAN kolom stempel belum terisi
      if (cekApakahHariIniAtauKemarin(dateInVal) && stempelInStr === "") {
        amData[amName].gmsIn.push({ mexId, mexName, pkgName: pkgInName });
        stampsToUpdate.push({ rowIdx: r + 1, colIdx: cols.stempelGmsIn + 1, value: todayStr });
        totalGmsIn++;
      }
    }

    // B. CEK GMS OPT-OUT
    if (cols.gmsDateOut !== -1 && cols.stempelGmsOut !== -1) {
      let dateOutVal = row[cols.gmsDateOut];
      let stempelOutStr = formatUntukStempel(row[cols.stempelGmsOut]);
      let pkgOutName = cols.gmsPkgOut !== -1 ? String(row[cols.gmsPkgOut] || "GMS Package").trim() : "GMS Package";

      if (cekApakahHariIniAtauKemarin(dateOutVal) && stempelOutStr === "") {
        amData[amName].gmsOut.push({ mexId, mexName, pkgName: pkgOutName });
        stampsToUpdate.push({ rowIdx: r + 1, colIdx: cols.stempelGmsOut + 1, value: todayStr });
        totalGmsOut++;
      }
    }

    // C. CEK LOCAL CAMPAIGN OPT-IN (Scan seluruh kolom promo lokal)
    if (cols.localPromoCols.length > 0) {
      let activePromosInRow = [];
      
      for (let p = 0; p < cols.localPromoCols.length; p++) {
        let promoCol = cols.localPromoCols[p];
        let promoDateVal = row[promoCol.index];
        
        if (cekApakahHariIniAtauKemarin(promoDateVal)) {
          activePromosInRow.push(promoCol.name);
        }
      }

      let stempelLocalStr = cols.stempelLocalIn !== -1 ? formatUntukStempel(row[cols.stempelLocalIn]) : "";
      
      if (activePromosInRow.length > 0 && stempelLocalStr === "") {
        amData[amName].localIn.push({
          mexId,
          mexName,
          promos: activePromosInRow.join(", ")
        });
        
        if (cols.stempelLocalIn !== -1) {
          stampsToUpdate.push({ rowIdx: r + 1, colIdx: cols.stempelLocalIn + 1, value: todayStr });
        }
        totalLocalIn++;
      }
    }
  }

  // Jika tidak ada data baru hari ini
  const totalEvents = totalGmsIn + totalGmsOut + totalLocalIn;
  if (totalEvents === 0) {
    Logger.log("[INFO] Tidak ada event GMS / Local Campaign baru hari ini (Semua baris sudah ter-stempel).");
    return false;
  }

  Logger.log(`[FOUND] Ditemukan event baru: ${totalGmsIn} GMS In, ${totalGmsOut} GMS Out, ${totalLocalIn} Local In.`);

  // 3. SUSUN & KIRIM PESAN REKAP KE GROUP WA / ADMIN
  kirimRekapGroupWA(amData, totalGmsIn, totalGmsOut, totalLocalIn);

  // 4. SUSUN & KIRIM PESAN DETAIL PRIVATE KE MASING-MASING AM
  kirimDetailPrivateWA(amData);

  // 5. UPDATE STEMPEL DI GOOGLE SHEETS & FLUSH
  for (let s = 0; s < stampsToUpdate.length; s++) {
    let item = stampsToUpdate[s];
    sheet.getRange(item.rowIdx, item.colIdx).setValue(item.value);
  }
  SpreadsheetApp.flush(); // Seketika kunci simpan ke Google Sheet
  Logger.log(`[STAMPED] Berhasil memperbarui ${stampsToUpdate.length} kolom stempel di Sheet.`);

  return true;
}

/**
 * Memuat buku kontak AM secara dinamis dari Sheet "Kontak AM"
 * Struktur Sheet "Kontak AM": Kolom A = Nama AM, Kolom B = No WhatsApp
 */
function muatBukuKontakAM(ss) {
  let kontakMap = {};
  
  // Cari Sheet dengan nama "Kontak AM", "Kontak", atau "AM"
  let kontakSheet = ss.getSheetByName(WA_CONFIG.KONTAK_SHEET_NAME) || 
                     ss.getSheetByName("Kontak") || 
                     ss.getSheetByName("AM");

  if (kontakSheet) {
    let data = kontakSheet.getDataRange().getValues();
    // Asumsi: Baris 1 Header (Nama AM | No WA), Data mulai Baris 2
    for (let i = 1; i < data.length; i++) {
      let nama = String(data[i][0] || "").trim();
      let phone = String(data[i][1] || "").trim();
      if (nama && phone) {
        kontakMap[nama] = phone;
      }
    }
    Logger.log(`[KONTAK] Berhasil membaca ${Object.keys(kontakMap).length} kontak AM dari Sheet "${kontakSheet.getName()}".`);
    return kontakMap;
  }

  Logger.log(`[KONTAK] Sheet "${WA_CONFIG.KONTAK_SHEET_NAME}" tidak ditemukan. Menggunakan daftar kontak fallback dari script.`);
  return WA_CONFIG.BUKU_KONTAK_FALLBACK || {};
}


/**
 * =================================================================
 * FORMATTER & PENGIRIMAN PESAN (MODERATE EMOJI - PROPOSIONAL)
 * =================================================================
 */

/**
 * Menyusun dan Mengirim Pesan Rekap Group WA (Proposional Emoji)
 */
function kirimRekapGroupWA(amData, totalGmsIn, totalGmsOut, totalLocalIn) {
  let tglIndo = formatTanggalIndo(new Date());
  
  let header = `📊 *REKAP HARIAN CAMPAIGN (GMS & LOCAL)*\n` +
               `📅 _${tglIndo}_\n` +
               `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  let body = "";
  let totalMexAktifSet = new Set();

  for (let amName in amData) {
    let item = amData[amName];
    let hasActivity = (item.gmsIn.length > 0 || item.gmsOut.length > 0 || item.localIn.length > 0);
    
    if (!hasActivity) continue;

    body += `👤 *AM: ${amName}*\n`;

    // GMS SECTION
    if (item.gmsIn.length > 0 || item.gmsOut.length > 0) {
      body += `⭐ *GMS:*\n`;
      for (let gIn of item.gmsIn) {
        body += `  • 🟢 ${gIn.mexName} *(${gIn.pkgName})*\n`;
        totalMexAktifSet.add(gIn.mexName);
      }
      for (let gOut of item.gmsOut) {
        body += `  • 🔴 ${gOut.mexName} *(Opt-Out: ${gOut.pkgName})*\n`;
        totalMexAktifSet.add(gOut.mexName);
      }
    }

    // LOCAL CAMPAIGN SECTION
    if (item.localIn.length > 0) {
      body += `🎉 *Local Campaign:*\n`;
      for (let lIn of item.localIn) {
        body += `  • 🟢 ${lIn.mexName} *(${lIn.promos})*\n`;
        totalMexAktifSet.add(lIn.mexName);
      }
    }

    body += `\n`;
  }

  let footer = `━━━━━━━━━━━━━━━━━━━━━\n` +
               `📈 *RINGKASAN TOTAL HARI INI:*\n` +
               `• GMS: 🟢 *${totalGmsIn}* Opt-In | 🔴 *${totalGmsOut}* Opt-Out\n` +
               `• Local Campaign: 🟢 *${totalLocalIn}* Opt-In\n` +
               `• Total Toko Aktif: *${totalMexAktifSet.size}* Merchant\n\n` +
               `_Detail laporan lengkap telah dikirim ke WA Private masing-masing AM._`;

  let fullMessage = header + body + footer;
  splitAndSendWA(WA_CONFIG.DEFAULT_ADMIN_PHONE, fullMessage);
}

/**
 * Menyusun dan Mengirim Pesan Detail Private ke WA Masing-Masing AM
 */
function kirimDetailPrivateWA(amData) {
  let tglIndo = formatTanggalIndo(new Date());

  for (let amName in amData) {
    let item = amData[amName];
    let hasActivity = (item.gmsIn.length > 0 || item.gmsOut.length > 0 || item.localIn.length > 0);
    
    if (!hasActivity) continue;

    let msg = `🔔 *LAPORAN DETAIL CAMPAIGN MERCHANT ANDA*\n` +
              `📅 _${tglIndo}_\n\n` +
              `Halo *${amName}*, berikut rincian merchant binaan Anda hari ini:\n\n`;

    // 1. GMS SECTION
    if (item.gmsIn.length > 0 || item.gmsOut.length > 0) {
      msg += `⭐ *--- GMS (GRAB MERCHANT SUPPORT) ---*\n`;
      
      if (item.gmsIn.length > 0) {
        msg += `🟢 *OPT-IN GMS (${item.gmsIn.length} Toko):*\n`;
        for (let gIn of item.gmsIn) {
          msg += `• *${gIn.mexName}* (${gIn.mexId})\n  └ Paket: ${gIn.pkgName}\n`;
        }
        msg += `\n`;
      }

      if (item.gmsOut.length > 0) {
        msg += `🔴 *OPT-OUT GMS (${item.gmsOut.length} Toko):*\n`;
        for (let gOut of item.gmsOut) {
          msg += `• *${gOut.mexName}* (${gOut.mexId})\n  └ Paket Dicabut: ${gOut.pkgName}\n`;
        }
        msg += `\n`;
      }
    }

    // 2. LOCAL CAMPAIGN SECTION
    if (item.localIn.length > 0) {
      msg += `🎉 *--- LOCAL CAMPAIGN ---*\n` +
             `🟢 *OPT-IN LOCAL CAMPAIGN (${item.localIn.length} Toko):*\n`;
      for (let lIn of item.localIn) {
        msg += `• *${lIn.mexName}* (${lIn.mexId})\n  └ Promo: ${lIn.promos}\n`;
      }
      msg += `\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━`;

    // Kirim ke nomor WA Pribadi AM
    splitAndSendWA(item.phone, msg);
    Utilities.sleep(1500); // Jeda antar AM
  }
}


/**
 * =================================================================
 * SMART AUTO-SPLITTER & UTILITIES
 * =================================================================
 */

/**
 * Memecah pesan otomatis jika melebihi MAX_CHAR_LIMIT (3.000 karakter)
 * tanpa terpotong di tengah baris toko.
 */
function splitAndSendWA(targetPhone, text) {
  if (text.length <= WA_CONFIG.MAX_CHAR_LIMIT) {
    kirimPesanWA(targetPhone, text);
    return;
  }

  // Jika panjang melebihi limit, bagi pesan berdasarkan paragraf/baris
  let lines = text.split('\n');
  let chunks = [];
  let currentChunk = "";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if ((currentChunk.length + line.length + 1) > WA_CONFIG.MAX_CHAR_LIMIT) {
      chunks.push(currentChunk);
      currentChunk = line + "\n";
    } else {
      currentChunk += line + "\n";
    }
  }
  if (currentChunk.trim() !== "") {
    chunks.push(currentChunk);
  }

  // Kirim setiap bagian berurutan
  for (let c = 0; c < chunks.length; c++) {
    let partHeader = `*(Bagian ${c + 1}/${chunks.length})*\n\n`;
    kirimPesanWA(targetPhone, partHeader + chunks[c]);
    if (c < chunks.length - 1) Utilities.sleep(2000);
  }
}

/**
 * Mencari posisi kolom secara dinamis berdasarkan nama Header di Baris 4
 */
function findHeaderIndexes(headers) {
  let result = {
    amName: -1,
    mexId: -1,
    mexName: -1,
    gmsPkgIn: -1,
    gmsDateIn: -1,
    gmsPkgOut: -1,
    gmsDateOut: -1,
    stempelGmsIn: -1,
    stempelGmsOut: -1,
    stempelLocalIn: -1,
    localPromoCols: []
  };

  for (let c = 0; c < headers.length; c++) {
    let name = String(headers[c] || "").trim().toLowerCase();
    
    if (name.includes("am name") || name === "am") result.amName = c;
    else if (name.includes("mex id") || name.includes("merchant id")) result.mexId = c;
    else if (name.includes("mex name") || name.includes("merchant name")) result.mexName = c;
    else if (name.includes("gms pkg in") || name.includes("pkg opt-in")) result.gmsPkgIn = c;
    else if (name.includes("live date in") || name.includes("date opt-in")) result.gmsDateIn = c;
    else if (name.includes("gms pkg out") || name.includes("pkg opt-out")) result.gmsPkgOut = c;
    else if (name.includes("live date out") || name.includes("date opt-out")) result.gmsDateOut = c;
    else if (name.includes("stempel gms in") || name.includes("stempel opt-in")) result.stempelGmsIn = c;
    else if (name.includes("stempel gms out") || name.includes("stempel opt-out")) result.stempelGmsOut = c;
    else if (name.includes("stempel local")) result.stempelLocalIn = c;
  }

  // Tentukan batas pencarian promo lokal (setelah stempel GMS/Local)
  let lastStampCol = Math.max(result.stempelGmsOut, result.stempelLocalIn, result.stempelGmsIn);
  if (lastStampCol === -1) lastStampCol = Math.max(result.gmsDateOut, result.gmsDateIn);

  // Ambil semua kolom yang berada setelah stempel sebagai kolom promo lokal
  for (let c = lastStampCol + 1; c < headers.length; c++) {
    let headerText = String(headers[c] || "").trim();
    if (headerText !== "" && !headerText.toLowerCase().includes("stempel")) {
      result.localPromoCols.push({ name: headerText, index: c });
    }
  }

  return result;
}

function getTodayDateString() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function formatUntukStempel(nilaiSel) {
  if (!nilaiSel || String(nilaiSel).trim() === "-" || String(nilaiSel).trim() === "") return "";
  let d = new Date(nilaiSel);
  if (isNaN(d.getTime())) return String(nilaiSel).trim(); 
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function cekApakahHariIniAtauKemarin(nilaiSel) {
  if (!nilaiSel || String(nilaiSel).trim() === "-" || String(nilaiSel).trim() === "") return false;
  let tglSel = new Date(nilaiSel);
  if (isNaN(tglSel.getTime())) return false; 
  let strTanggalSheet = Utilities.formatDate(tglSel, Session.getScriptTimeZone(), "yyyy-MM-dd");
  let hariIni = new Date();
  let strHariIni = Utilities.formatDate(hariIni, Session.getScriptTimeZone(), "yyyy-MM-dd");
  let kemarin = new Date();
  kemarin.setDate(kemarin.getDate() - 1);
  let strKemarin = Utilities.formatDate(kemarin, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return (strTanggalSheet === strHariIni || strTanggalSheet === strKemarin);
}

function formatTanggalIndo(tglStr) {
  let tgl = new Date(tglStr);
  if (isNaN(tgl.getTime())) return tglStr; 
  let bulanIndo = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return tgl.getDate() + " " + bulanIndo[tgl.getMonth()] + " " + tgl.getFullYear();
}

/**
 * Core Function: Mengirim pesan via HTTP POST ke Server WA API Render
 */
function kirimPesanWA(phone, message) {
  const url = WA_CONFIG.WA_API_URL + "/api/send";
  
  const payload = {
    "phone": phone,
    "message": message
  };
  
  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": {
      "X-API-Key": WA_CONFIG.WA_API_KEY
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    Logger.log("[WA SENT] Phone: " + phone + " | Result: " + JSON.stringify(result));
    return result;
  } catch(e) {
    Logger.log("[WA ERROR] Gagal mengirim ke " + phone + ": " + e);
  }
}
