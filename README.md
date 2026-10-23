# Morrow Notes

MERN notes app (React + Vite, Express, MongoDB Atlas) with Firebase Google sign-in.
In production, one Render web service builds the React client and serves it together with the API.
Uploaded files (avatars, note images, attachments) are stored in MongoDB (GridFS), so they survive redeploys.

## Deploy to Render (via GitHub)

1. **Push to GitHub**
   ```bash
   git init && git add . && git commit -m "Morrow Notes"
   git branch -M main
   git remote add origin https://github.com/<you>/morrow-notes.git
   git push -u origin main
   ```
2. **MongoDB Atlas** – Network Access → add `0.0.0.0/0` (Render's outbound IPs change). Copy your connection string, with the password filled in and a database name, e.g.
   `mongodb+srv://USER:PASSWORD@HOST/morrow_notes?retryWrites=true&w=majority`
3. **Firebase Admin key** – Firebase Console → Project settings → Service accounts → *Generate new private key*. You will paste the whole JSON file contents into Render in the next step.
4. **Render** – New → *Blueprint* → pick your repo (it reads `render.yaml`). Fill in the prompted values:
   - `MONGODB_URI` – from step 2
   - `FIREBASE_SERVICE_ACCOUNT_JSON` – the full JSON from step 3
   - `VITE_FIREBASE_*` – the Web app config from Firebase (Project settings → General → Your apps)
5. **Authorize the domain** – once Render gives you the URL (`https://morrow-notes.onrender.com`), add its hostname in Firebase Console → Authentication → Settings → **Authorized domains**. Google sign-in fails until you do.

Notes: the free Render plan sleeps after ~15 min idle (first request takes ~30–60 s). `VITE_*` values are baked in at build time, so changing one requires a redeploy.

## Run locally (one command)

One-time setup:
1. `server/.env` - replace `MONGODB_URI` with your Atlas connection string (or keep the local MongoDB one).
2. `server/firebase-service-account.json` - Firebase Console -> Project settings -> Service accounts -> *Generate new private key*, save the file under that name.
3. `client/.env` - already filled with the Firebase web config (copy from `client/.env.example` if you start fresh).

Then, from the project folder:

```bash
npm start
```

The first run installs everything and builds the client (a minute or two); after that it starts right away. Open http://localhost:5002. If you change anything in `client/`, just run `npm start` again and it rebuilds.

Optional hot-reload development: `npm run dev:server` in one terminal and `npm run dev:client` in another, then open http://localhost:5173.

## Per-account notes

Every request carries the signed-in user's Firebase ID token. The server verifies it and only reads or writes notes whose `ownerUid` matches that user, so each Google account sees only its own notes, profile and settings.

## Never commit

`server/.env`, `client/.env`, and `server/firebase-service-account.json` are in `.gitignore`. Keep it that way.

## Limits

- Files are served from MongoDB; Atlas free tier has 512 MB total storage.
- Files uploaded to the old local version (`server/src/uploads/`) are not migrated; images inside old notes will show as broken.
- Notes created before sign-in was added have no owner and don't appear in any account.
