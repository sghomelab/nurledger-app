/**
 * English dictionary (FR-115) — the reference language.
 *
 * M6 sweep scope (M6-TASKS): tabs, sell, inventory, settings, dialogs.
 * Document BODIES stay English by design (receipt FR-109, labels FR-317,
 * PO FR-306) — only UI chrome/labels live here. Payment-method names
 * (Cash / Card / PayNow / Touch 'n Go) are business-locale DATA from
 * `paymentMethodsFor(outlet.locale)` and are deliberately NOT in this file.
 *
 * Interpolation: `{param}` tokens, substituted by `t()`.
 * Plurals: English has them — use the paired `…One`/`…Many` keys.
 */
const en = {
  // ── shared ────────────────────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.done': 'Done',
  'common.add': 'Add',
  'common.remove': 'Remove',

  // ── tab bar (tabs/_layout) ────────────────────────────────────────────
  'tab.sell': 'Sell',
  'tab.inventory': 'Inventory',
  'tab.expiry': 'Expiry',
  'tab.insights': 'Insights',
  'tab.shift': 'Shift',

  // ── sync status (sell banner + settings) ──────────────────────────────
  'sync.syncing': 'Syncing…',
  'sync.queuedAuto': '{n} ops queued — syncing automatically',
  'sync.error': 'Sync error: {err}',
  'sync.synced': 'Synced {time}',
  'sync.connected': 'Connected',
  'sync.queuedOff': '{n} ops queued · Sync off',
  'sync.queuedOffShort': '{n} ops queued · sync off',
  'sync.off': 'Sync off — sales queue locally',

  // ── sell / register (tabs/index) ──────────────────────────────────────
  'sell.scanPlaceholder': 'Scan or type barcode + Enter',
  'sell.cameraA11y': 'Camera scan (deferred)',
  'sell.registerLocked': 'Register locked',
  'sell.registerLockedSell': 'Open a shift first (Shift tab) to start selling.',
  'sell.registerLockedPay': 'Open a shift first (Shift tab) to take payment.',
  'sell.scanFailed': 'Scan failed',
  'sell.lockBanner': 'Register locked — no shift open.',
  'sell.openShift': 'Open shift',
  'sell.searchPlaceholder': 'Search name, SKU or barcode',
  'sell.currentOrder': 'Current Order',
  'sell.itemsOne': '{n} item',
  'sell.itemsMany': '{n} items',
  'sell.clear': 'Clear',
  'sell.cartEmpty': 'Scan a barcode, search, or tap a product above to start the order.',
  'sell.orderDiscount': 'Order discount',
  'sell.charge': 'CHARGE',
  'sell.chargeAmount': 'CHARGE {amount}',
  'sell.processing': 'PROCESSING…',
  'sell.error': 'Error',
  'sell.saleFailed': 'Sale failed',
  'sell.couldNotOpenShift': 'Could not open shift',
  'sell.quantity': 'Quantity',
  'sell.couldNotAdd': 'Could not add',
  'sell.cameraScan': 'Camera scan',
  'sell.cameraScanMsg':
    'Camera barcode scanning is deferred (FR-100). Use a scanner wedge, type the barcode, or tap a product — everything works offline.',
  'sell.invalidWeight': 'Invalid weight',
  'sell.invalidWeightMsg': 'Enter the weight in kg, e.g. 0.25 or 1.25',
  'sell.weighTitle': 'Weighed — {name}',
  'sell.weighSub': '{stock} in stock · {price}/kg',
  'sell.weighLine': '{weight} · line price',
  'sell.weighAdd': 'Add to order',
  'sell.openShiftFloat': 'Open shift — starting float',
  'sell.promptPrice': 'Price',
  'sell.promptDiscount': 'Discount',

  // ── cart line (CartLineRow) ───────────────────────────────────────────
  'cart.discount': 'discount',

  // ── totals (TotalsBlock) ──────────────────────────────────────────────
  'totals.subtotal': 'Subtotal',
  'totals.discount': 'Discount',
  'totals.tax': 'Tax ({rate}%, {mode})',
  'totals.taxIncl': 'incl.',
  'totals.taxExcl': 'excl.',
  'totals.total': 'TOTAL',
  'totals.grossMargin': 'Gross margin (FIFO)',

  // ── payment sheet (PaymentSheet) ─────────────────────────────────────
  'pay.totalDue': 'TOTAL DUE',
  'pay.cashTendered': 'Cash tendered',
  'pay.changeDue': 'Change due',
  'pay.split': 'Split',
  'pay.splitHint': 'Split evenly across the first two methods (FR-107).',
  'pay.qrPrepareHint': 'Prepare the payment to show the customer a reference.',
  'pay.qrPrepare': 'Prepare QR',
  'pay.reference': 'REFERENCE',
  'pay.due': '{amount} due',
  'pay.chargeTerminal': 'Charge on terminal',
  'pay.mobileWallet': 'Mobile wallet',
  'pay.stub': 'MVP stub (ADR-006): {detail} — no live acquirer is wired.',
  'pay.cardDetail': 'tender via the external card terminal',
  'pay.mobileDetail': 'confirm the wallet payment at the counter',
  'pay.completeSale': 'Complete sale',
  'pay.prepareFirst': 'Prepare first',
  'pay.confirmPaid': 'Confirm paid',

  // ── receipt chrome only (ReceiptView) — body stays English (FR-109) ──
  'receipt.success': 'Payment successful',

  // ── money prompt (MoneyPrompt) ────────────────────────────────────────
  'money.hint': '{currency} — enter in major units (e.g. 1.50)',

  // ── quick chips (QuickChips) ──────────────────────────────────────────
  'quick.noMatch': 'No products match',

  // ── stock status chips (Chip) ─────────────────────────────────────────
  'status.in_stock': 'In Stock',
  'status.low_stock': 'Low Stock',
  'status.depleted': 'Depleted',
  'status.sold_out': 'Sold Out',

  // ── inventory tab (tabs/inventory) ────────────────────────────────────
  'inv.purchaseOrders': 'Purchase Orders',
  'inv.stocktake': 'Stocktake',
  'inv.labels': 'Label printing',
  'inv.suppliers': 'Suppliers',
  'inv.csv': 'Product data (CSV)',
  'inv.lowStockOnly': 'Low Stock Only',
  'inv.noMatch': 'No products match',
  'inv.noneYet': 'No products yet',

  // ── gate actions (PinPrompt header) ───────────────────────────────────
  'gate.discount': 'Discount',
  'gate.price_override': 'Price override',
  'gate.stock_adjust': 'Stock adjustment',
  'gate.close_shift': 'Close shift',
  'gate.store_settings': 'Store settings',
  'gate.refund': 'Refund',
  'gate.stocktake_apply': 'Apply stocktake',

  // ── PIN prompt (PinPrompt) ────────────────────────────────────────────
  'pin.required': '{action} — PIN required',
  'pin.hint': 'Enter the owner/manager PIN to continue (min {n} digits).',
  'pin.noPinSet': 'No owner/manager has a PIN set yet — add one in Settings.',
  'pin.wrong': 'Wrong PIN — try again',

  // ── stock adjustment (AdjustStockDialog) ──────────────────────────────
  'adjust.title': 'Adjust stock',
  'adjust.onHand': 'On hand',
  'adjust.qtyBase': 'Quantity (base units) *',
  'adjust.qtyGrams': 'Quantity (grams) *',
  'adjust.reason': 'Reason * (required)',
  'adjust.reasonPlaceholder': 'Or type a reason…',
  'adjust.confirm': 'Confirm adjustment',
  'adjust.applying': 'Applying…',
  'adjust.foot': 'Applies an immutable ledger entry. {money} = no cost change recorded.',
  'adjust.failed': 'Adjustment failed',
  'adjust.reason.damage': 'Damage',
  'adjust.reason.lost': 'Lost / stolen',
  'adjust.reason.found': 'Found',
  'adjust.reason.counting': 'Counting correction',
  'adjust.reason.quality': 'Quality / returned',

  // ── first-run choice (FirstRunScreen) ──────────────────────────────────
  'firstRun.title': 'Set up your store',
  'firstRun.body': 'How would you like to start?',
  'firstRun.sample': 'Load sample data',
  'firstRun.sampleSub':
    '11 products with stock, batches and prices — explore the app first. You can reset any time in Settings.',
  'firstRun.empty': 'Start empty',
  'firstRun.emptySub': 'No products, stock or sales. Add your own items from the Inventory tab.',
  'firstRun.busy': 'Setting up…',

  // ── settings screen ───────────────────────────────────────────────────
  'settings.title': 'Store settings',
  'settings.store': 'Store',
  'settings.storeName': 'Store name *',
  'settings.storeNamePh': 'e.g. My Provision Store',
  'settings.language': 'Language · FR-115',
  'settings.appLanguage': 'App language',
  'settings.langEn': 'English',
  'settings.langMs': 'Bahasa Melayu',
  'settings.languageNote':
    'Applies to this device only. Business settings (currency, tax, payment methods) are unchanged.',
  'settings.currency': 'Currency · FR-602',
  'settings.sellIn': 'Sell in',
  'settings.isoCode': 'ISO currency code (3 letters)',
  'settings.currencyNote':
    'Changing the currency reinterprets existing prices and cart amounts in the new currency — review product prices after switching.',
  'settings.tax': 'Tax · FR-600',
  'settings.taxRegime': 'Tax regime',
  'settings.rate': 'Rate % (0–40)',
  'settings.pricingMode': 'Pricing mode',
  'settings.inclusive': 'Inclusive',
  'settings.exclusive': 'Exclusive',
  'settings.taxNote':
    'Inclusive: prices already contain tax (SG GST style). Exclusive: tax is added on top. Presets are suggestions only — any rate works via Custom.',
  'settings.cloud': 'Cloud sync · FR-503',
  'settings.cloudNote':
    'Optional. Link this store to its own free Supabase project (BYO — your data stays in your project). Everything keeps working offline either way; queued sales sync when you turn it on.',
  'settings.connect': 'Connect your backend',
  'settings.owner': 'owner: {email}',
  'settings.syncNow': 'Sync now',
  'settings.disconnect': 'Disconnect',
  'settings.disconnectTitle': 'Disconnect backend?',
  'settings.disconnectMsg':
    'The connection is removed from this device. Sales, stock and the sync queue are NOT touched — reconnect any time to resume from where it left off.',
  'settings.disconnected': 'Disconnected',
  'settings.disconnectedMsg': 'You can connect again any time.',
  'settings.receipt': 'Receipt · FR-109',
  'settings.printerWidth': 'Printer width',
  'settings.receiptNote': 'The on-screen receipt (and any future printer output) renders at this width.',
  'settings.saveBtn': 'Save settings',
  'settings.typeOtherIso': 'Type another ISO code…',
  'settings.customRate': 'Custom rate…',
  'settings.missingFields': 'Missing fields',
  'settings.missingName': 'Store name is required.',
  'settings.invalidCurrency': 'Invalid currency',
  'settings.invalidCurrencyMsg': 'Currency must be a 3-letter ISO code, e.g. SGD or MYR.',
  'settings.unknownCurrency': 'Unknown currency',
  'settings.unknownCurrencyMsg': '“{code}” is not a recognized currency code.',
  'settings.invalidRate': 'Invalid tax rate',
  'settings.invalidRateMsg': 'Rate must be 0–40 with up to 2 decimals, e.g. 7.75.',
  'settings.saved': 'Saved',
  'settings.savedMsg': 'Store settings updated.',
  'settings.saveFailed': 'Save failed',
  'settings.danger': 'Danger zone',
  'settings.resetData': 'Reset all data',
  'settings.resetDataMsg':
    'Deletes every product, stock record, sale and setting on this device, then restarts setup from scratch. Cannot be undone.',
  'settings.resetTitle': 'Reset all data?',
  'settings.resetMsg':
    'Everything on this device — products, stock, sales, shifts and settings — is permanently deleted, then you choose how to start again. This cannot be undone.',

  // ── cloud setup wizard (cloud-setup) ───────────────────────────────────
  'cloudsetup.title': 'Connect your backend',
  'cloudsetup.step.creds': 'Connection',
  'cloudsetup.step.sql': 'Run the SQL',
  'cloudsetup.step.account': 'Owner account',
  'cloudsetup.step.connect': 'Connect',
  'cloudsetup.err.missingKeys': 'Project URL, anon key and service_role key are all required.',
  'cloudsetup.note.noSchema': 'Backend reachable — but the schema is not deployed yet.',
  'cloudsetup.note.upgrade':
    'Backend reachable — it runs schema v{old}, but this app needs v{new}. Run the updated script below (safe to re-run — it never touches existing data).',
  'cloudsetup.note.deployed': 'Backend reachable and the Nurledger schema is deployed.',
  'cloudsetup.err.schemaNotDetected':
    'Schema still not detected. Make sure the SQL Editor query finished without errors, then check again.',
  'cloudsetup.err.schemaOld':
    'Still on schema v{old} — the script below adds v{new}. Make sure the SQL Editor query finished without errors, then check again.',
  'cloudsetup.err.missingAccount': 'Enter the owner email and a password (min 6 characters).',
  'cloudsetup.note.confirmEmail':
    'Account created — confirm the email link Supabase just sent, then tap “Sign in”.',
  'cloudsetup.note.existingAccount': 'This email already has an account — sign in instead.',
  'cloudsetup.err.noOutlet': 'Local outlet missing — the DB was not seeded',
  'cloudsetup.connected': 'Connected',
  'cloudsetup.connectedJoined':
    'This device joined the store already linked to this backend. Sync is OFF — turn it on in Settings → Cloud sync when you are ready.',
  'cloudsetup.connectedNew':
    'Your backend is linked. Sync is OFF — turn it on in Settings → Cloud sync when you are ready.',
  'cloudsetup.checkConnection': 'Check connection',
  'cloudsetup.checkSetup': 'I’ve run it — check setup',
  'cloudsetup.createAccount': 'Create owner account',
  'cloudsetup.signIn': 'Sign in',
  'cloudsetup.connect': 'Create store & connect',
  'cloudsetup.working': 'Working…',
  'cloudsetup.copySql': 'Copy SQL',
  'cloudsetup.copied': 'Copied',
  'cloudsetup.copiedMsg': 'SQL bundle copied — paste it into the SQL Editor.',
  'cloudsetup.yourProject': 'Your Supabase project',
  'cloudsetup.yourProjectHint':
    'BYO cloud: create a FREE Supabase project (supabase.com) and paste its credentials here. Your data lives in YOUR project — Nurledger never operates or accesses it.',
  'cloudsetup.projectUrl': 'Project URL',
  'cloudsetup.anonKey': 'anon / public key',
  'cloudsetup.serviceKey': 'service_role key',
  'cloudsetup.ownerEmail': 'Owner email',
  'cloudsetup.ownerPassword': 'Owner password',
  'cloudsetup.keyNote':
    'Used only on this device, only to verify your schema. It never leaves the phone.',
  'cloudsetup.sqlTitle': 'Run the setup SQL (schema v{v})',
  'cloudsetup.sqlTitleUpgrade': 'Run the updated setup SQL (schema v{v} — upgrade)',
  'cloudsetup.sqlUpgradeHint':
    'Your project already runs an older version of the setup. This updated script adds the new tables and rules — re-running it is safe and it NEVER touches your existing data.',
  'cloudsetup.sqlSteps':
    '1. Open your project → SQL Editor → New query. 2. Paste this bundle and press Run. 3. Come back and check.',
  'cloudsetup.accountTitle': 'Owner account',
  'cloudsetup.accountHint':
    'Creates the store’s owner login in YOUR project (it is how this device — and any second device — signs in to sync). Cashiers keep using their local PINs; this account is for sync only.',
  'cloudsetup.email': 'Email',
  'cloudsetup.password': 'Password',
  'cloudsetup.storeTitle': 'Link this store',
  'cloudsetup.storeHint':
    'Creates the outlet record and makes the signed-in owner a member, then saves the connection on this device.',
  'cloudsetup.minChars': 'min 6 characters',

  // ── picker overlay (PickerOverlay) ────────────────────────────────────
  'picker.titleCurrency': 'Currency',
  'picker.titleTax': 'Tax',
} as const;

export default en;
export type EnDict = typeof en;
