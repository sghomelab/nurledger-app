/**
 * Bahasa Melayu dictionary (FR-115) — the launch locale for Malaysia.
 *
 * Typed as Record<EnKey, string>: the compiler rejects a missing OR extra
 * key (i18n.test.ts additionally enforces non-empty values at runtime).
 *
 * Malay has no noun plural — "3 item" is correct (no paired …One/…Many
 * distinction; the paired keys are translated identically).
 */
import type { EnDict } from './en';

const ms: Record<keyof EnDict, string> = {
  // ── shared ────────────────────────────────────────────────────────────
  'common.cancel': 'Batal',
  'common.save': 'Simpan',
  'common.done': 'Selesai',
  'common.add': 'Tambah',
  'common.remove': 'Kurangkan',

  // ── tab bar ───────────────────────────────────────────────────────────
  'tab.sell': 'Jual',
  'tab.inventory': 'Inventori',
  'tab.expiry': 'Tarikh Luput',
  'tab.insights': 'Analitik',
  'tab.shift': 'Syif',

  // ── sync status ───────────────────────────────────────────────────────
  'sync.syncing': 'Menyegerak…',
  'sync.queuedAuto': '{n} operasi menunggu — menyegerak secara automatik',
  'sync.error': 'Ralat segerak: {err}',
  'sync.synced': 'Disegerak {time}',
  'sync.connected': 'Disambung',
  'sync.queuedOff': '{n} operasi menunggu · Segerak ditutup',
  'sync.queuedOffShort': '{n} operasi menunggu · segerak tutup',
  'sync.off': 'Segerak ditutup — jualan bergilir di tempat',

  // ── sell / register ───────────────────────────────────────────────────
  'sell.scanPlaceholder': 'Imbas atau taip barcode + Enter',
  'sell.cameraA11y': 'Imbas kamera (ditangguhkan)',
  'sell.registerLocked': 'Kaunter terkunci',
  'sell.registerLockedSell': 'Buka syif dahulu (tab Syif) untuk mula menjual.',
  'sell.registerLockedPay': 'Buka syif dahulu (tab Syif) untuk menerima bayaran.',
  'sell.scanFailed': 'Gagal mengimbas',
  'sell.lockBanner': 'Kaunter terkunci — tiada syif dibuka.',
  'sell.openShift': 'Buka syif',
  'sell.searchPlaceholder': 'Cari nama, SKU atau barcode',
  'sell.currentOrder': 'Pesanan Semasa',
  'sell.itemsOne': '{n} item',
  'sell.itemsMany': '{n} item',
  'sell.clear': 'Kosongkan',
  'sell.cartEmpty': 'Imbas barcode, cari, atau ketik produk di atas untuk memulakan pesanan.',
  'sell.orderDiscount': 'Diskaun pesanan',
  'sell.charge': 'CAJ',
  'sell.chargeAmount': 'CAJ {amount}',
  'sell.processing': 'MEMPROSES…',
  'sell.error': 'Ralat',
  'sell.saleFailed': 'Jualan gagal',
  'sell.couldNotOpenShift': 'Gagal membuka syif',
  'sell.quantity': 'Kuantiti',
  'sell.couldNotAdd': 'Gagal menambah',
  'sell.cameraScan': 'Imbasan kamera',
  'sell.cameraScanMsg':
    'Imbasan barcode dengan kamera ditangguhkan (FR-100). Guna wedge scanner, taip barcode, atau ketik produk — semuanya berfungsi secara luar talian.',
  'sell.invalidWeight': 'Berat tidak sah',
  'sell.invalidWeightMsg': 'Masukkan berat dalam kg, cth. 0.25 atau 1.25',
  'sell.weighTitle': 'Ditimbang — {name}',
  'sell.weighSub': '{stock} dalam stok · {price}/kg',
  'sell.weighLine': '{weight} · harga baris',
  'sell.weighAdd': 'Tambah ke pesanan',
  'sell.openShiftFloat': 'Buka syif — float permulaan',
  'sell.promptPrice': 'Harga',
  'sell.promptDiscount': 'Diskaun',

  // ── cart line ─────────────────────────────────────────────────────────
  'cart.discount': 'diskaun',

  // ── totals ────────────────────────────────────────────────────────────
  'totals.subtotal': 'Jumlah kecil',
  'totals.discount': 'Diskaun',
  'totals.tax': 'Cukai ({rate}%, {mode})',
  'totals.taxIncl': 'termasuk',
  'totals.taxExcl': 'tak termasuk',
  'totals.total': 'JUMLAH',
  'totals.grossMargin': 'Margin kasar (FIFO)',

  // ── payment sheet ─────────────────────────────────────────────────────
  'pay.totalDue': 'JUMLAH PERLU DIBAYAR',
  'pay.cashTendered': 'Duit tunai diterima',
  'pay.changeDue': 'Pulangan perlu',
  'pay.split': 'Pecah',
  'pay.splitHint': 'Pecahkan sama rata ke dua kaedah pertama (FR-107).',
  'pay.qrPrepareHint': 'Sediakan pembayaran untuk menunjukkan rujukan kepada pelanggan.',
  'pay.qrPrepare': 'Sediakan QR',
  'pay.reference': 'RUJUKAN',
  'pay.due': 'Perlu dibayar {amount}',
  'pay.chargeTerminal': 'Caj melalui terminal',
  'pay.mobileWallet': 'Dompet mudah alih',
  'pay.stub': 'Stub MVP (ADR-006): {detail} — tiada pemproses langsung disambungkan.',
  'pay.cardDetail': 'bayar melalui terminal kad luaran',
  'pay.mobileDetail': 'sahkan bayaran dompet di kaunter',
  'pay.completeSale': 'Siapkan jualan',
  'pay.prepareFirst': 'Sediakan dahulu',
  'pay.confirmPaid': 'Sahkan dibayar',

  // ── receipt chrome only ───────────────────────────────────────────────
  'receipt.success': 'Pembayaran berjaya',

  // ── money prompt ──────────────────────────────────────────────────────
  'money.hint': '{currency} — masukkan dalam unit utama (cth. 1.50)',

  // ── quick chips ───────────────────────────────────────────────────────
  'quick.noMatch': 'Tiada produk sepadan',

  // ── stock status chips ────────────────────────────────────────────────
  'status.in_stock': 'Dalam Stok',
  'status.low_stock': 'Stok Rendah',
  'status.depleted': 'Defisit',
  'status.sold_out': 'Habis',

  // ── inventory tab ─────────────────────────────────────────────────────
  'inv.purchaseOrders': 'Perintah Beli',
  'inv.stocktake': 'Kira Stok',
  'inv.labels': 'Cetakan Label',
  'inv.suppliers': 'Pembekal',
  'inv.csv': 'Data produk (CSV)',
  'inv.lowStockOnly': 'Stok Rendah Sahaja',
  'inv.noMatch': 'Tiada produk sepadan',
  'inv.noneYet': 'Belum ada produk',

  // ── gate actions ──────────────────────────────────────────────────────
  'gate.discount': 'Diskaun',
  'gate.price_override': 'Penggantian harga',
  'gate.stock_adjust': 'Pelarasan stok',
  'gate.close_shift': 'Tutup syif',
  'gate.store_settings': 'Tetapan kedai',
  'gate.refund': 'Bayaran balik',
  'gate.stocktake_apply': 'Terapkan kira stok',

  // ── PIN prompt ────────────────────────────────────────────────────────
  'pin.required': '{action} — PIN diperlukan',
  'pin.hint': 'Masukkan PIN pemilik/urus tadbir untuk meneruskan (min. {n} digit).',
  'pin.noPinSet': 'Tiada pemilik/urus tadbir yang menetapkan PIN lagi — tambahkan dalam Tetapan.',
  'pin.wrong': 'PIN salah — cuba lagi',

  // ── stock adjustment ──────────────────────────────────────────────────
  'adjust.title': 'Laraskan stok',
  'adjust.onHand': 'Dalam simpanan',
  'adjust.qtyBase': 'Kuantiti (unit asas) *',
  'adjust.qtyGrams': 'Kuantiti (gram) *',
  'adjust.reason': 'Sebab * (wajib)',
  'adjust.reasonPlaceholder': 'Atau taipkan sebab…',
  'adjust.confirm': 'Sahkan pelarasan',
  'adjust.applying': 'Menerapkan…',
  'adjust.foot': 'Menerapkan entri ledger yang kekal. {money} = tiada perubahan kos direkodkan.',
  'adjust.failed': 'Pelarasan gagal',
  'adjust.reason.damage': 'Kerosakan',
  'adjust.reason.lost': 'Hilang / dicuri',
  'adjust.reason.found': 'Ditemui',
  'adjust.reason.counting': 'Pembetulan kiraan',
  'adjust.reason.quality': 'Kualiti / dikembalikan',

  // ── first-run choice (FirstRunScreen) ──────────────────────────────────
  'firstRun.title': 'Tetapkan kedai anda',
  'firstRun.body': 'Bagaimanakah anda mahu bermula?',
  'firstRun.sample': 'Muat data contoh',
  'firstRun.sampleSub':
    '11 produk dengan stok, batch dan harga — terokai aplikasi dahulu. Boleh ditetapkan semula bila-bila masa dalam Tetapan.',
  'firstRun.empty': 'Mula kosong',
  'firstRun.emptySub': 'Tiada produk, stok atau jualan. Tambahkan item anda sendiri dari tab Inventori.',
  'firstRun.busy': 'Menyiapkan…',

  // ── settings screen ───────────────────────────────────────────────────
  'settings.title': 'Tetapan kedai',
  'settings.store': 'Kedai',
  'settings.storeName': 'Nama kedai *',
  'settings.storeNamePh': 'cth. Kedai Runcit Saya',
  'settings.language': 'Bahasa · FR-115',
  'settings.appLanguage': 'Bahasa aplikasi',
  'settings.langEn': 'English',
  'settings.langMs': 'Bahasa Melayu',
  'settings.languageNote':
    'Hanya terpakai pada peranti ini. Tetapan perniagaan (mata wang, cukai, kaedah pembayaran) tidak berubah.',
  'settings.currency': 'Mata Wang · FR-602',
  'settings.sellIn': 'Jual dalam',
  'settings.isoCode': 'Kod mata wang ISO (3 huruf)',
  'settings.currencyNote':
    'Menukar mata wang akan mentafsir semula harga dan jumlah troli sedia ada dalam mata wang baharu — semak semula harga produk selepas bertukar.',
  'settings.tax': 'Cukai · FR-600',
  'settings.taxRegime': 'Sistem cukai',
  'settings.rate': 'Kadar % (0–40)',
  'settings.pricingMode': 'Mod harga',
  'settings.inclusive': 'Termasuk',
  'settings.exclusive': 'Tak termasuk',
  'settings.taxNote':
    'Termasuk: harga sudah mengandungi cukai (gaya GST SG). Tak termasuk: cukai ditambah di atas. Praset ialah cadangan sahaja — sebarang kadar berfungsi melalui Suai.',
  'settings.cloud': 'Segerak awan · FR-503',
  'settings.cloudNote':
    'Pilihan. Hubungkan kedai ini kepada projek Supabase percuma anda sendiri (BYO — data anda kekal dalam projek anda). Semuanya terus berfungsi secara luar talian; jualan yang bergilir akan disegerak apabila anda menghidupkannya.',
  'settings.connect': 'Sambungkan backend anda',
  'settings.owner': 'pemilik: {email}',
  'settings.syncNow': 'Segerak sekarang',
  'settings.disconnect': 'Putuskan',
  'settings.disconnectTitle': 'Putuskan backend?',
  'settings.disconnectMsg':
    'Sambungan akan dibuang daripada peranti ini. Jualan, stok dan gilir segerak TIDAK disentuh — sambung semula bila-bila masa untuk meneruskan dari tempat terdahulu.',
  'settings.disconnected': 'Diputuskan',
  'settings.disconnectedMsg': 'Anda boleh menyambung semula bila-bila masa.',
  'settings.receipt': 'Resit · FR-109',
  'settings.printerWidth': 'Lebar pencetak',
  'settings.receiptNote': 'Resit di skrin (dan sebarang output pencetak pada masa hadapan) dirender pada lebar ini.',
  'settings.saveBtn': 'Simpan tetapan',
  'settings.typeOtherIso': 'Taipkan kod ISO lain…',
  'settings.customRate': 'Kadar suai…',
  'settings.missingFields': 'Medan tiada',
  'settings.missingName': 'Nama kedai adalah wajib.',
  'settings.invalidCurrency': 'Mata wang tidak sah',
  'settings.invalidCurrencyMsg': 'Mata wang mesti kod ISO 3 huruf, cth. SGD atau MYR.',
  'settings.unknownCurrency': 'Mata wang tidak dikenali',
  'settings.unknownCurrencyMsg': '“{code}” bukan kod mata wang yang dikenali.',
  'settings.invalidRate': 'Kadar cukai tidak sah',
  'settings.invalidRateMsg': 'Kadar mesti 0–40 dengan sehingga 2 perpuluhan, cth. 7.75.',
  'settings.saved': 'Disimpan',
  'settings.savedMsg': 'Tetapan kedai dikemas kini.',
  'settings.saveFailed': 'Gagal menyimpan',
  'settings.danger': 'Zon bahaya',
  'settings.resetData': 'Tetapkan semula semua data',
  'settings.resetDataMsg':
    'Memadamkan semua produk, rekod stok, jualan dan tetapan pada peranti ini, kemudian memulakan tetapan dari awal. Tidak boleh diundur.',
  'settings.resetTitle': 'Tetapkan semula semua data?',
  'settings.resetMsg':
    'Semua pada peranti ini — produk, stok, jualan, sif dan tetapan — dipadamkan secara kekal, kemudian anda memilih cara untuk bermula semula. Tidak boleh diundur.',

  // ── cloud setup wizard (cloud-setup) ───────────────────────────────────
  'cloudsetup.title': 'Sambungkan backend anda',
  'cloudsetup.step.creds': 'Sambungan',
  'cloudsetup.step.sql': 'Jalankan SQL',
  'cloudsetup.step.account': 'Akaun pemilik',
  'cloudsetup.step.connect': 'Sambung',
  'cloudsetup.err.missingKeys': 'URL projek, kunci anon dan kunci service_role semuanya diperlukan.',
  'cloudsetup.note.noSchema': 'Backend boleh dihubungi — tetapi schema belum dipasang.',
  'cloudsetup.note.upgrade':
    'Backend boleh dihubungi — ia menggunakan schema v{old}, tetapi aplikasi ini memerlukan v{new}. Jalankan skrip yang dikemas kini di bawah (selamat dijalankan semula — ia tidak menyentuh data sedia ada).',
  'cloudsetup.note.deployed': 'Backend boleh dihubungi dan schema Nurledger telah dipasang.',
  'cloudsetup.err.schemaNotDetected':
    'Schema masih tidak dikesan. Pastikan query SQL Editor selesai tanpa ralat, kemudian semak semula.',
  'cloudsetup.err.schemaOld':
    'Masih pada schema v{old} — skrip di bawah menambah v{new}. Pastikan query SQL Editor selesai tanpa ralat, kemudian semak semula.',
  'cloudsetup.err.missingAccount': 'Masukkan emel pemilik dan kata laluan (min 6 aksara).',
  'cloudsetup.note.confirmEmail':
    'Akaun dibuat — sahkan pautan emel yang baru dihantar Supabase, kemudian ketuk “Log masuk”.',
  'cloudsetup.note.existingAccount': 'Emel ini sudah mempunyai akaun — log masuk sahaja.',
  'cloudsetup.err.noOutlet': 'Kedai tempatan tiada — DB tidak disemai',
  'cloudsetup.connected': 'Disambungkan',
  'cloudsetup.connectedJoined':
    'Peranti ini menyertai kedai yang sudah dipautkan kepada backend ini. Segerak OFF — hidupkan dalam Tetapan → Segerak awan bila anda bersedia.',
  'cloudsetup.connectedNew':
    'Backend anda telah dipautkan. Segerak OFF — hidupkan dalam Tetapan → Segerak awan bila anda bersedia.',
  'cloudsetup.checkConnection': 'Semak sambungan',
  'cloudsetup.checkSetup': 'Saya sudah jalankan — semak tetapan',
  'cloudsetup.createAccount': 'Cipta akaun pemilik',
  'cloudsetup.signIn': 'Log masuk',
  'cloudsetup.connect': 'Cipta kedai & sambung',
  'cloudsetup.working': 'Menyiapkan…',
  'cloudsetup.copySql': 'Salin SQL',
  'cloudsetup.copied': 'Disalin',
  'cloudsetup.copiedMsg': 'Bundel SQL disalin — tampalkannya ke SQL Editor.',
  'cloudsetup.yourProject': 'Projek Supabase anda',
  'cloudsetup.yourProjectHint':
    'Awan BYO: cipta projek Supabase PERCUMA (supabase.com) dan tampalkan kelayakannya di sini. Data anda berada dalam PROJEK ANDA — Nurledger tidak pernah mengendalikannya atau memaksanya.',
  'cloudsetup.projectUrl': 'URL projek',
  'cloudsetup.anonKey': 'kunci anon / awam',
  'cloudsetup.serviceKey': 'kunci service_role',
  'cloudsetup.ownerEmail': 'Emel pemilik',
  'cloudsetup.ownerPassword': 'Kata laluan pemilik',
  'cloudsetup.keyNote': 'Digunakan hanya pada peranti ini, hanya untuk mengesahkan schema anda. Ia tidak keluar dari telefon.',
  'cloudsetup.sqlTitle': 'Jalankan SQL tetapan (schema v{v})',
  'cloudsetup.sqlTitleUpgrade': 'Jalankan SQL tetapan yang dikemas kini (schema v{v} — kemas kini)',
  'cloudsetup.sqlUpgradeHint':
    'Projek anda sudah menjalankan versi lama tetapan. Skrip yang dikemas kini ini menambah jadual dan peraturan baharu — menjalankannya semula adalah selamat dan ia TIDAK PERNAH menyentuh data sedia ada anda.',
  'cloudsetup.sqlSteps':
    '1. Buka projek anda → SQL Editor → Query baharu. 2. Tampalkan bundel ini dan tekan Run. 3. Kembali dan semak.',
  'cloudsetup.accountTitle': 'Akaun pemilik',
  'cloudsetup.accountHint':
    'Mencipta log masuk pemilik kedai dalam PROJEK ANDA (inilah cara peranti ini — dan peranti kedua — log masuk untuk segerak). Kasir terus menggunakan PIN tempatan mereka; akaun ini adalah untuk segerak sahaja.',
  'cloudsetup.email': 'Emel',
  'cloudsetup.password': 'Kata laluan',
  'cloudsetup.storeTitle': 'Pautkan kedai ini',
  'cloudsetup.storeHint':
    'Mencipta rekod kedai dan menjadikan pemilik yang log masuk sebagai ahli, kemudian menyimpan sambungan pada peranti ini.',
  'cloudsetup.minChars': 'min 6 aksara',

  // ── picker overlay ────────────────────────────────────────────────────
  'picker.titleCurrency': 'Mata wang',
  'picker.titleTax': 'Cukai',
};

export default ms;
