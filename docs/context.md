# Backend Context - Map Leads Backend

## Overview

`map-leads-backend` is an Express + TypeScript API deployed to Cloud Run.
It uses Firebase Admin SDK for authentication and Firestore persistence.

## Runtime And Stack

- Runtime: Node.js (ESM)
- Framework: Express 4
- Language: TypeScript
- Auth: Firebase ID token verification (`firebase-admin/auth`)
- Database: Firestore (`firebase-admin/firestore`)
- CORS: enabled globally
- JSON body limit: `1mb`

## Architecture

- `src/index.ts` currently contains:
- HTTP bootstrap and middleware
- Auth and superadmin guards
- Firestore data operations
- Apify integration
- Leads enrichment and cleanup helpers

Current design is a single-module service (no layered folders yet).

## External Integrations

- Firebase Auth (ID token validation, user disable/delete actions)
- Firestore collections:
- `profiles`
- `searches`
- `leads`
- `subscriptions`
- Apify actor: `compass~crawler-google-places`

## Environment Variables

- `PORT` (default: `8080`)
- `SUPERADMIN_EMAIL` (default: `afiliadosprobusiness@gmail.com`)
- `APIFY_TOKEN` (optional)

## Security Rules

- Protected routes require `Authorization: Bearer <firebase_id_token>`.
- Superadmin route requires authenticated user email to match `SUPERADMIN_EMAIL`.
- Superadmin cannot suspend or delete own account.

## Business Rules

- Plans and limits:
- `starter`: 2000
- `growth`: 5000
- `pro`: 15000
- Suspended users cannot run searches.
- Superadmin requester cannot run searches.
- If `APIFY_TOKEN` is missing, search endpoint runs in demo mode using mock leads.
- For `growth` and `pro`, system tries basic email enrichment from website HTML.

## Operational Notes

- Service exposes health endpoint at `GET /health`.
- Non-matching routes return `404 { "error": "Not found" }`.
