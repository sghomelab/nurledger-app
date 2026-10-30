# Nurledger — User Guide

A guide for store owners and staff. Start with **[Setting up cloud sync](#setting-up-cloud-sync)** if you want your shop's data to back up and appear on more than one device.

> **Good to know first:** Nurledger works **completely offline**. You can run a whole
> day of sales, stock and shifts with no internet at all. Cloud sync is an **optional
> extra** that (a) keeps a backup of your data and (b) lets more than one tablet/phone
> in the shop share the same stock and sales. **It is switched OFF by default** —
> nothing is sent anywhere until you turn it on.

---

## Setting up cloud sync

Cloud sync connects Nurledger to **your own free Supabase account**. Supabase is a
free online database service. Because it's *your* account, **your data belongs to you** —
the people who make Nurledger can never see it. You can switch it off or delete it at
any time, and your data on the device is never affected.

You only need to do this **once per shop** (about 5–10 minutes). Every other device in
the shop then connects using the same details.

### What you'll need
- A phone or tablet with Nurledger installed (this "first" device).
- Internet access for the setup itself.
- An email address for the Supabase account.

### Step 1 — Create your free Supabase account
1. On any phone or computer, open **<https://supabase.com>**.
2. Tap **Sign up** (you can sign up with your email, or with Google).
3. Fill in your email and choose a password. Check your email and confirm it if asked.
4. You're now logged into the Supabase dashboard.

> Supabase's **free plan is more than enough** for a single shop. You will not be charged
> unless you deliberately upgrade it.

### Step 2 — Create a project for your shop
1. In the dashboard, tap **New project** (or "Create a new project").
2. Give it a name — use your **shop name** (e.g. "My Provision Store").
3. Choose a **database password** and keep it somewhere safe (you won't use it often).
4. Pick a region — choose the one **closest to where your shop is** (e.g. Singapore).
5. Tap **Create new project** and wait 1–2 minutes for it to be ready.

### Step 3 — Copy your project's details
1. Open your new project.
2. In the left menu, go to **Project settings** (the gear icon) → **API**.
3. You'll see three things. Copy **all three**:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **anon / public key** — a long key labelled `anon public` (this is safe to share with the app)
   - **service_role key** — a long key labelled `service_role` (**keep this private** — it's like a master password for your database)

> The **service_role** key is the only sensitive one. Nurledger uses it at setup to
> **check** that your shop database structure was created correctly (it cannot create
> it for you — see Step 4), and then keeps it stored on your device. Don't paste it
> anywhere else or share it.

### Step 4 — Connect it in Nurledger
1. Open **Nurledger** on your first device.
2. Go to **Settings** (the gear / Store card).
3. Find **Cloud sync** — it will say **Off**.
4. Tap **Connect your store**.
5. Paste the three details (Project URL, anon key, service_role key) and tap **Continue**.
   Nurledger checks that it can reach your project.

   **One manual step (about 1 minute):** Supabase does not let apps create tables in a
   project on your behalf, so you run a short setup script in the project yourself:
   1. Nurledger shows the script on screen — tap **Copy** (it is long, do not type it).
   2. Back in the Supabase dashboard, open **SQL Editor** (left menu) → **New query**.
   3. Paste the script into the editor box and tap **Run**.
   4. You should see a short success message (a few tables created).
   5. Go back to Nurledger and tap **Check that the setup ran**. When it is right you
      will see a **Connected** confirmation.

   This script is safe to re-run any time — it creates the tables and rules for your
   products, sales and stock, and never touches existing data.


### Step 5 — Create your owner login
1. Still in **Cloud sync**, tap **Create owner account** (if prompted).
2. Enter your **email** and choose a **password**. This is *your* login for the shop —
   it's stored in your own Supabase account from Step 1.
3. If Supabase asks you to confirm the email, open your inbox and tap the link.

That's it — **your shop is now connected**.

### Step 6 — Turn sync ON
1. In **Cloud sync**, flip the **Sync** switch to **On**.
2. Your sales, stock and products now back up to your Supabase project, and any queued
   offline activity uploads automatically.
3. You'll see **"Last synced: just now"** (or a similar line) under the switch.

You can flip this switch **On/Off anytime**. Turning it **Off** stops syncing but **never
deletes anything** — your sales keep being saved on the device, and they upload the next
time you turn it back on.

---

## Adding more devices (a second tablet or phone)
1. Install Nurledger on the second device.
2. On the second device: **Settings → Cloud sync → Connect your store**.
3. Paste the **same** three details from your Supabase project (Step 3).
4. Sign in with the **same owner email + password** from Step 5.
5. Turn **Sync** **On**.

Both devices now share the same shop: sell on one, and after it syncs, the other sees the
updated stock. If two tablets sell the same item offline and both sync, Nurledger combines
them correctly — **no sale is counted twice**, and stock stays accurate.

## Adding cashiers (staff)
Staff **don't need a Supabase account.** You (the owner) add them in the app:
1. **Settings → Staff** (or when opening a shift, pick "Add cashier").
2. Give the person a **name**, a **role** (e.g. Cashier), and a **PIN**.
3. On a shared tablet, that person taps their name and enters their PIN to take the register.

The PIN is used only on the device (for permissions like discounts and closing a shift).
The PIN is never sent to Supabase. To remove someone, just deactivate their account — they
lose access immediately, and their past sales stay in your records.

---

## Turning it all off / leaving
- **Pause:** flip **Sync** to **Off** — nothing uploads, everything stays on the device.
- **Disconnect:** **Settings → Cloud sync → Disconnect** removes the connection. Your
  device data is untouched.
- **Delete your data:** it's in your Supabase project — delete the project from the
  Supabase dashboard and it's gone. Nurledger (the app) never has a copy of it.

## Is my data private?
Yes. Your data lives in **your own Supabase project**, under **your own account**. The
Nurledger app is just a client that talks to your project. The people who build Nurledger
do not have access to your data. You can verify any time by logging into
<https://supabase.com> and opening your project.

## Troubleshooting
| Problem | What to do |
|---|---|
| "Connection failed" when connecting | Re-check the **Project URL** (must end in `.supabase.co`) and that you pasted the **anon** key, not a truncated one. Make sure the project is still running (free projects pause after a week of no use — opening the project in the dashboard wakes it). |
| Nothing is syncing after turning it On | Wait a moment, then pull to refresh / reopen Settings. Check the device has internet. The "N ops queued" line shows what's waiting. |
| I pasted the wrong service_role key | Disconnect, then Connect again with the correct keys. (The setup is repeatable — it won't duplicate your data.) |
| Free project paused (after ~1 week idle) | Open your project in the Supabase dashboard once; it wakes up and sync resumes. |

---
*Need more detail on any part of the shop (selling, stock, shifts, reports)?*
*Ask for that section of the guide — it's being written up per feature.*
