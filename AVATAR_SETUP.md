# BroTalk — Accounts + Profile Pictures setup

Everything code-side is done. Two things need *your* accounts (I can't log in as you):
provisioning the database and creating the R2 bucket. Both are one-time.

---

## 1. Turn on accounts (Render Postgres) — required

Accounts are fully coded; the live server just has no database, so signup/login
currently return **503 "Account service is offline"**.

**Easiest path — apply the Blueprint (auto-provisions everything):**

1. Render dashboard → **New → Blueprint**.
2. Pick the **Barcode162/BroTalk** repo. Render reads `render.yaml`.
3. It will show a plan that includes the **brotalk web service** + a new
   **brotalk-db** (free Postgres). `DATABASE_URL` and a generated `JWT_SECRET`
   are wired automatically.
4. It will prompt for the five `R2_*` values — you can paste them now (see §2)
   or leave them blank and add them later (accounts still work; only avatar
   upload stays off until they're set).
5. **Apply**. After deploy, `POST /auth/signup` works.

> If Render says the `brotalk` service already exists and won't re-link to the
> blueprint, just create the database manually instead: **New → Postgres (free)**,
> then on the existing brotalk service → **Environment** → add `DATABASE_URL`
> = the database's *Internal Connection String*. That alone turns accounts on.

**Verify:** `curl -X POST https://brotalk.onrender.com/auth/signup -H "Content-Type: application/json" -d '{"username":"test123","password":"password123"}'`
should return a `{ token, user }` JSON instead of the 503.

---

## 2. Turn on profile pictures (Cloudflare R2) — optional but you asked for it

Avatars are stored in Cloudflare R2 (S3-compatible object storage; free tier is
10 GB + no egress fees). Until these are set the app runs fine and the upload
button just reports "Image storage not configured" (HTTP 501).

1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `brotalk-avatars`).
2. Bucket → **Settings** → enable **Public access** (R2.dev subdomain), or
   attach a custom domain. Copy that public base URL — it looks like
   `https://pub-<hash>.r2.dev`. This is `R2_PUBLIC_BASE`.
3. R2 → **Manage R2 API Tokens** → **Create API token**, scope **Object
   Read & Write** for this bucket. Copy the **Access Key ID** and **Secret
   Access Key** (shown once).
4. Your **Account ID** is in the R2 overview / dashboard URL.
5. On the Render **brotalk** service → **Environment**, set:

   | Key | Value |
   |-----|-------|
   | `R2_ACCOUNT_ID` | your Cloudflare account ID |
   | `R2_ACCESS_KEY_ID` | the API token's access key id |
   | `R2_SECRET_ACCESS_KEY` | the API token's secret |
   | `R2_BUCKET` | `brotalk-avatars` |
   | `R2_PUBLIC_BASE` | `https://pub-<hash>.r2.dev` |

6. Save → Render redeploys. The server log should print
   `[server] R2 avatar storage enabled`.

**How it works once on:** the client resizes any picked image to a 128px square
PNG, uploads it to `POST /auth/avatar`, the server stores it at
`avatars/<userId>.png` in R2 and saves the public URL to `users.avatar_url`.
That URL is returned by login/`/auth/me`, sent to room peers in the `peers`
message, and to DM contacts via `identify`/`dm` — so everyone sees the picture.

> **CORS note:** uploads go *through the server* (not browser→R2 directly), so
> no R2 CORS config is needed. Images are loaded by `<img>` tag, which is exempt
> from CORS. The desktop/mobile CSPs were updated to allow `img-src https:`.
