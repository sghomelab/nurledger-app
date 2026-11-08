# 0001 report — PIN hardening verified and merged

**Result: ALL PASS. Merged to main `7c4c063` and pushed (2026-11-08).**

## Diff review (step 1)

`git diff origin/main...origin/claude/pin-hardening --stat` (base `149095d`, branch tip `ecb4307`): exactly the 10 expected files — `app/(tabs)/shift.tsx`, `src/components/PinPrompt.tsx`, `src/hooks/useShift.ts`, `src/lib/roles.ts`, `src/repositories/userRepository.ts`, `src/i18n/{en,ms,fil}.ts`, `src/__tests__/roles.test.ts`, `docs/USER-GUIDE.md`. No tracked node_modules, nothing else. `docs/USER-GUIDE.md` auto-merged cleanly, keeping both the pre-existing HTTPS-only note (line 326) and the new PIN section (line 397).

## Gates (step 2) — all green

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx jest` (default TZ) | 544/544 (was 539 before merge, +5 new tests) |
| `npx jest` (TZ=America/Los_Angeles) | 544/544 |
| `npm run test:strict` | 0 skipped |

## Device checks (step 3) — cs-test AVD (emulator-5554), fresh DB via uninstall

| Check | Result | Evidence |
|---|---|---|
| a. Cashier → Owner switch | PASS | Prompt "Switch user — PIN required"; 11111111 → "Wrong PIN — try again"; 1234 switched to Owner. (Rejection fires at 8 digits — progressive matching, by design in `src/lib/pin.ts`.) |
| b. Owner → anyone, no prompt | PASS | Owner → Jun, Mia and Bob all switched with no prompt; Jun → Owner required PIN 1234. |
| c. Add manager/owner as cashier | PASS | Manager without PIN → alert "Owner and manager users need a PIN of 4–8 digits." (user not created); with PIN → "Add user — PIN required" gate; wrong PIN created nothing (verified via user list); 1234 created Ana (Manager). Owner role: manager PIN 4321 rejected at the gate; owner PIN 1234 created Bob (Owner). |
| d. Cashier adds cashier | PASS | Jun added cashiers (Mia, Kim) with no PIN prompt. |
| e. Change PIN… | PASS | Picker "Change whose PIN?" → re-auth gate every time (wrong PIN rejected; manager PIN accepted for a cashier target) → "Change PIN for Jun" sheet, masked input, Save disabled at 3 digits (screenshot), enabled at 4, saved → "PIN changed". |
| f. Owner PIN 1234 → 5678 | PASS | Gate rejected manager PIN 4321, accepted owner PIN 1234. After change: old 1234 failed, 5678 worked on the close-shift gate (full open-shift → sell-free → close → Z-Report cycle as cashier Jun). |
| g. Reset all data | PASS | As Owner: confirm dialog (documents "Owner PIN goes back to 1234") → fresh setup screen → re-seeded → verified 1234 unlocks a gated switch again. (As cashier the reset correctly sits behind the store-settings PIN gate — pre-existing behavior.) |
| h. MS + FIL repeats of a/c/e | PASS | Malay: "Tukar pengguna — PIN diperlukan", "PIN salah — cuba lagi", "Tambah pengguna", "Pengguna pemilik dan pengurus memerlukan PIN 4–8 digit.", "Tukar PIN untuk Jun", "PIN telah ditukar". Filipino: "Magpalit ng user — kailangan ang PIN", "Maling PIN — subukan ulit", "Magdagdag ng user", "Kailangan ng PIN na 4–8 digit ang mga user na may-ari at manager.", "Kaninong PIN ang papalitan?", "Palitan ang PIN ni Jun", "Napalitan na ang PIN". Screenshots confirm no English fragments in app UI and no truncated titles/buttons (longer FIL strings render fully). |
| i. USER-GUIDE | PASS | "## Adding cashiers and managing PINs" present with correct content; Language line lists **English, Bahasa Melayu or Filipino**; old "Adding cashiers (staff)" section removed. |

## Merge (step 4)

`git merge --no-ff origin/claude/pin-hardening` → pushed. Main: `300b417` → **`7c4c063`**.

## Emulator state (step 5)

Restored clean: `com.nurlogic.nurledger` uninstalled from emulator-5554 (test DB, created users and PIN changes wiped). Pre-existing unrelated apps (Tasbeeh, Conscious Spending) untouched; AVD left running as found.

**Environment note for future device checks on cs-test:** `input tap` on the bottom tab bar is silently swallowed (not the 63 px taskbar — taps in the app window near y≈2200–2340 die). Workaround: deep links `nurledger://sell|inventory|expiry|insights|shift|settings` work perfectly. Also close the IME (`KEYCODE_BACK`) after every `input text` before tapping sheet buttons — the open keyboard shifts bottom-sheet layout and steals taps.
