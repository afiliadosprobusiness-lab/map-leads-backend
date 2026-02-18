# API Contract - Map Leads Backend

## Base

- Content-Type: `application/json`
- Auth for protected endpoints: `Authorization: Bearer <firebase_id_token>`

## Error Format

All error responses use:

```json
{
  "error": "message"
}
```

## Endpoints

### GET `/health`

- Auth: No
- Response `200`:

```json
{
  "ok": true,
  "service": "map-leads-backend"
}
```

### POST `/api/run-apify-search`

- Auth: Yes (authenticated user)
- Request body:

```json
{
  "search_id": "string"
}
```

- Success `200`:

```json
{
  "success": true,
  "mode": "demo | live",
  "leads": 0
}
```

- Error cases:
- `400` when `search_id` is missing/invalid
- `401` unauthorized or invalid token
- `403` suspended account
- `404` search not found or not owned by requester
- `429` leads quota exceeded
- `500` unexpected/internal error

### POST `/api/superadmin-users`

- Auth: Yes (superadmin email must match `SUPERADMIN_EMAIL`)
- Request body base:

```json
{
  "action": "list_users | set_plan | suspend_user | restore_user | delete_user",
  "user_id": "string",
  "plan": "starter | growth | pro",
  "query": "string",
  "limit": 200
}
```

#### Action `list_users`

- Required fields: `action`
- Optional fields: `query`, `limit` (bounded to 1..1000)
- Success `200`:

```json
{
  "users": [
    {
      "id": "uid",
      "email": "user@email.com",
      "full_name": "Name",
      "plan": "starter",
      "leads_used": 0,
      "leads_limit": 2000,
      "is_suspended": false,
      "suspended_at": null,
      "created_at": "2026-02-18T00:00:00.000Z",
      "updated_at": "2026-02-18T00:00:00.000Z"
    }
  ]
}
```

#### Action `set_plan`

- Required fields: `action`, `user_id`, `plan`
- Success `200`:

```json
{
  "success": true
}
```

- Side effects:
- Updates `profiles/{user_id}` with `plan` and `leads_limit`
- Upserts `subscriptions/{user_id}` with active status

#### Action `suspend_user`

- Required fields: `action`, `user_id`
- Success `200`:

```json
{
  "success": true
}
```

- Side effects:
- Sets `profiles/{user_id}.is_suspended = true`
- Sets Firebase Auth user `disabled = true`

#### Action `restore_user`

- Required fields: `action`, `user_id`
- Success `200`:

```json
{
  "success": true
}
```

- Side effects:
- Sets `profiles/{user_id}.is_suspended = false`
- Sets Firebase Auth user `disabled = false`

#### Action `delete_user`

- Required fields: `action`, `user_id`
- Success `200`:

```json
{
  "success": true
}
```

- Side effects:
- Deletes user leads/searches by `user_id`
- Deletes `subscriptions/{user_id}`
- Deletes `profiles/{user_id}`
- Deletes Firebase Auth user

#### Common errors for superadmin endpoint

- `400` missing or invalid required fields, unknown action, or self-targeting protected actions
- `401` unauthorized or invalid token
- `403` requester is not superadmin
- `500` unexpected/internal error

## Contract Changelog

- 2026-02-18: Initial contract created from current implementation. Type: non-breaking. Impact: documentation only.
