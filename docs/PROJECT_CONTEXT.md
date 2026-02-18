# Map Leads Backend - Operational Summary

> **Last updated:** 2026-02-18
> **Source of truth:** `docs/context.md`

## Service

- Express + TypeScript API deployed on Cloud Run.
- Firebase Admin SDK for Firebase ID token verification and Firestore access.

## Main Endpoints

- `GET /health`
- `POST /api/run-apify-search`
- `POST /api/superadmin-users`

## Security

- Protected endpoints require `Authorization: Bearer <firebase_id_token>`.
- Superadmin endpoint requires requester email to match `SUPERADMIN_EMAIL`.
- Superadmin cannot suspend or delete own account.
- Superadmin requester cannot run scraping jobs.

## Key Business Rules

- Plans: `starter` (2000), `growth` (5000), `pro` (15000).
- Suspended users cannot run searches.
- If `APIFY_TOKEN` is missing, scraping runs in demo mode.

## Environment Variables

- `PORT` (default `8080`)
- `SUPERADMIN_EMAIL` (default `afiliadosprobusiness@gmail.com`)
- `APIFY_TOKEN` (optional)
