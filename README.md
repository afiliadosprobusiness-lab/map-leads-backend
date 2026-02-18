# map-leads-backend

Backend API for MapLeads, deployed on Cloud Run.

## Stack

- Node.js + Express + TypeScript
- Firebase Admin SDK (Auth + Firestore)
- Apify integration for lead extraction

## Endpoints

- `GET /health`
- `POST /api/run-apify-search`
- `POST /api/superadmin-users`

All protected endpoints require:

`Authorization: Bearer <firebase_id_token>`

## Environment Variables

- `PORT` (default `8080`)
- `SUPERADMIN_EMAIL` (default `afiliadosprobusiness@gmail.com`)
- `APIFY_TOKEN` (optional, if missing uses demo mode)

## Local Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Cloud Run Deploy

```bash
gcloud run deploy map-leads-backend \
  --source . \
  --region us-central1 \
  --project leadswidget \
  --allow-unauthenticated \
  --set-env-vars SUPERADMIN_EMAIL=afiliadosprobusiness@gmail.com
```
