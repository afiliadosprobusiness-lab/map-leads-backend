import cors from "cors";
import express, { Request, Response } from "express";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";

initializeApp();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const db = getFirestore();
const adminAuth = getAuth();

const ACTOR_ID = "compass~crawler-google-places";
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL ?? "afiliadosprobusiness@gmail.com").toLowerCase();
const PORT = Number(process.env.PORT ?? 8080);

const PLAN_LIMITS = {
  starter: 2000,
  growth: 5000,
  pro: 15000,
} as const;

type PlanType = keyof typeof PLAN_LIMITS;
type SearchStatus = "queued" | "running" | "completed" | "failed";

type DecodedUser = {
  uid: string;
  email?: string;
};

interface SearchData {
  user_id: string;
  keyword: string;
  city: string;
  country: string;
  max_results: number;
  status: SearchStatus;
  total_results: number;
  error_message?: string | null;
}

interface ProfileData {
  email: string;
  full_name: string | null;
  plan: PlanType;
  leads_used: number;
  leads_limit: number;
  is_suspended: boolean;
  suspended_at: string | null;
}

interface LeadPayload {
  business_name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  rating: number | null;
  reviews_count: number | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface RunSearchInput {
  search_id?: string;
}

interface SuperadminInput {
  action?: "list_users" | "set_plan" | "suspend_user" | "restore_user" | "delete_user";
  user_id?: string;
  plan?: PlanType;
  query?: string;
  limit?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function parseBearerToken(authorization?: string): string | null {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return authorization.slice(7).trim() || null;
}

async function requireAuthenticatedUser(req: Request, res: Response): Promise<DecodedUser | null> {
  const token = parseBearerToken(req.header("authorization"));
  if (!token) {
    sendError(res, 401, "Unauthorized");
    return null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
    };
  } catch {
    sendError(res, 401, "Invalid token");
    return null;
  }
}

async function requireSuperadmin(req: Request, res: Response): Promise<DecodedUser | null> {
  const user = await requireAuthenticatedUser(req, res);
  if (!user) return null;

  if ((user.email ?? "").toLowerCase() !== SUPERADMIN_EMAIL) {
    sendError(res, 403, "Forbidden");
    return null;
  }

  return user;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return null;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function buildMockLeads(search: SearchData): LeadPayload[] {
  const maxItems = Math.min(search.max_results || 100, 10);

  return Array.from({ length: maxItems }, (_, index) => ({
    business_name: `${search.keyword} ${index + 1} - ${search.city}`,
    address: `Main Street ${index + 1}, ${search.city}, ${search.country}`,
    phone: `+1 555 ${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
    website: `https://example${index + 1}.com`,
    email: null,
    rating: Number((3.2 + Math.random() * 1.6).toFixed(1)),
    reviews_count: Math.floor(Math.random() * 500),
    category: search.keyword,
    latitude: null,
    longitude: null,
  }));
}

function normalizeApifyLeads(items: unknown[]): LeadPayload[] {
  return items.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const location = (item.location ?? {}) as Record<string, unknown>;
    const categories = Array.isArray(item.categories) ? item.categories : [];

    return {
      business_name: asStringOrNull(item.title),
      address: asStringOrNull(item.address),
      phone: asStringOrNull(item.phone),
      website: asStringOrNull(item.website),
      email: asStringOrNull(item.email),
      rating: parseNumber(item.totalScore),
      reviews_count: parseNumber(item.reviewsCount),
      category: asStringOrNull(categories[0]),
      latitude: parseNumber(location.lat),
      longitude: parseNumber(location.lng),
    };
  });
}

function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === "string") return value;
  return nowIso();
}

async function writeLeadsAndFinalize(userId: string, searchId: string, leads: LeadPayload[], currentLeadsUsed: number): Promise<void> {
  const profileRef = db.collection("profiles").doc(userId);
  const searchRef = db.collection("searches").doc(searchId);

  if (leads.length === 0) {
    await searchRef.set(
      {
        status: "completed",
        total_results: 0,
        error_message: null,
        updated_at: nowIso(),
      },
      { merge: true },
    );
    return;
  }

  const chunks = chunkArray(leads, 400);

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const batch = db.batch();

    for (const lead of chunk) {
      const leadRef = db.collection("leads").doc();
      batch.set(leadRef, {
        ...lead,
        search_id: searchId,
        user_id: userId,
        created_at: nowIso(),
      });
    }

    const isLastChunk = index === chunks.length - 1;
    if (isLastChunk) {
      batch.set(
        searchRef,
        {
          status: "completed",
          total_results: leads.length,
          error_message: null,
          updated_at: nowIso(),
        },
        { merge: true },
      );

      batch.set(
        profileRef,
        {
          leads_used: currentLeadsUsed + leads.length,
          updated_at: nowIso(),
        },
        { merge: true },
      );
    }

    await batch.commit();
  }
}

async function maybeEnrichEmails(plan: PlanType, searchId: string, leads: LeadPayload[]): Promise<void> {
  if (plan !== "growth" && plan !== "pro") return;

  const candidates = leads.filter((lead) => lead.website && !lead.email).slice(0, 20);

  for (const lead of candidates) {
    try {
      const response = await fetch(lead.website!, { signal: AbortSignal.timeout(5000) });
      const html = await response.text();
      const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (!emailMatch) continue;

      const leadSnapshot = await db
        .collection("leads")
        .where("search_id", "==", searchId)
        .where("website", "==", lead.website)
        .limit(1)
        .get();

      if (leadSnapshot.empty) continue;
      await leadSnapshot.docs[0].ref.set({ email: emailMatch[0] }, { merge: true });
    } catch {
      // Ignore enrichment errors
    }
  }
}

async function deleteByUserId(collectionName: string, userId: string): Promise<void> {
  while (true) {
    const snapshot = await db.collection(collectionName).where("user_id", "==", userId).limit(400).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();

    if (snapshot.size < 400) break;
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "map-leads-backend" });
});

app.post("/api/run-apify-search", async (req, res) => {
  const user = await requireAuthenticatedUser(req, res);
  if (!user) return;

  const payload = req.body as RunSearchInput;
  const searchId = payload.search_id;

  if (!searchId || typeof searchId !== "string") {
    sendError(res, 400, "search_id required");
    return;
  }

  const searchRef = db.collection("searches").doc(searchId);

  try {
    const searchSnapshot = await searchRef.get();
    if (!searchSnapshot.exists) {
      sendError(res, 404, "Search not found");
      return;
    }

    const search = searchSnapshot.data() as SearchData;
    if (search.user_id !== user.uid) {
      sendError(res, 404, "Search not found");
      return;
    }

    const profileRef = db.collection("profiles").doc(user.uid);
    const profileSnapshot = await profileRef.get();
    if (!profileSnapshot.exists) {
      sendError(res, 500, "Profile not found");
      return;
    }

    const profile = profileSnapshot.data() as ProfileData;
    const leadsUsed = profile.leads_used ?? 0;
    const leadsLimit = profile.leads_limit ?? 2000;
    const plan = (profile.plan as PlanType) ?? "starter";

    if (profile.is_suspended) {
      await searchRef.set({ status: "failed", error_message: "Account suspended", updated_at: nowIso() }, { merge: true });
      sendError(res, 403, "Account suspended");
      return;
    }

    if (leadsUsed >= leadsLimit) {
      await searchRef.set({ status: "failed", error_message: "Leads quota exceeded", updated_at: nowIso() }, { merge: true });
      sendError(res, 429, "Leads quota exceeded");
      return;
    }

    await searchRef.set({ status: "running", error_message: null, updated_at: nowIso() }, { merge: true });

    if (!APIFY_TOKEN) {
      const mockLeads = buildMockLeads(search);
      await writeLeadsAndFinalize(user.uid, searchId, mockLeads, leadsUsed);
      res.json({ success: true, mode: "demo", leads: mockLeads.length });
      return;
    }

    const searchQuery = `${search.keyword} in ${search.city}, ${search.country}`;
    const apifyResponse = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}&waitForFinish=300`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray: [searchQuery],
        maxCrawledPlacesPerSearch: search.max_results,
        language: "en",
        exportPlaceUrls: false,
        includeHistogram: false,
        includeOpeningHours: false,
        includePeopleAlsoSearch: false,
      }),
    });

    if (!apifyResponse.ok) {
      const details = await apifyResponse.text();
      throw new Error(`Apify error [${apifyResponse.status}]: ${details}`);
    }

    const apifyRun = (await apifyResponse.json()) as { data?: { id?: string; defaultDatasetId?: string } };

    if (apifyRun.data?.id) {
      await searchRef.set({ apify_run_id: apifyRun.data.id, updated_at: nowIso() }, { merge: true });
    }

    if (!apifyRun.data?.defaultDatasetId) {
      await searchRef.set({ status: "completed", total_results: 0, updated_at: nowIso() }, { merge: true });
      res.json({ success: true, mode: "live", leads: 0 });
      return;
    }

    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${apifyRun.data.defaultDatasetId}/items?token=${APIFY_TOKEN}&format=json`);
    const items = (await datasetResponse.json()) as unknown[];
    const leads = Array.isArray(items) ? normalizeApifyLeads(items) : [];

    await writeLeadsAndFinalize(user.uid, searchId, leads, leadsUsed);
    await maybeEnrichEmails(plan, searchId, leads);

    res.json({ success: true, mode: "live", leads: leads.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    await searchRef.set({ status: "failed", error_message: message, updated_at: nowIso() }, { merge: true }).catch(() => undefined);
    sendError(res, 500, message);
  }
});

app.post("/api/superadmin-users", async (req, res) => {
  const requester = await requireSuperadmin(req, res);
  if (!requester) return;

  const payload = req.body as SuperadminInput;
  const action = payload.action;

  if (!action) {
    sendError(res, 400, "action is required");
    return;
  }

  try {
    if (action === "list_users") {
      const limitValue = Math.min(Math.max(Number(payload.limit ?? 200), 1), 1000);
      const queryText = (payload.query ?? "").trim().toLowerCase();

      const profilesSnapshot = await db.collection("profiles").orderBy("created_at", "desc").limit(limitValue).get();
      const users = profilesSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() as Partial<ProfileData> & { created_at?: unknown; updated_at?: unknown };
          return {
            id: docSnapshot.id,
            email: data.email ?? "",
            full_name: data.full_name ?? null,
            plan: data.plan ?? "starter",
            leads_used: data.leads_used ?? 0,
            leads_limit: data.leads_limit ?? 2000,
            is_suspended: data.is_suspended ?? false,
            suspended_at: data.suspended_at ?? null,
            created_at: timestampToIso(data.created_at),
            updated_at: timestampToIso(data.updated_at),
          };
        })
        .filter((item) => {
          if (!queryText) return true;
          return item.email.toLowerCase().includes(queryText) || (item.full_name ?? "").toLowerCase().includes(queryText);
        });

      res.json({ users });
      return;
    }

    const userId = payload.user_id;
    if (!userId || typeof userId !== "string") {
      sendError(res, 400, "Valid user_id is required");
      return;
    }

    if (action === "set_plan") {
      const plan = payload.plan;
      if (!plan || !(plan in PLAN_LIMITS)) {
        sendError(res, 400, "Valid plan is required");
        return;
      }

      const now = nowIso();
      await db.collection("profiles").doc(userId).set(
        {
          plan,
          leads_limit: PLAN_LIMITS[plan],
          updated_at: now,
        },
        { merge: true },
      );

      await db.collection("subscriptions").doc(userId).set(
        {
          user_id: userId,
          plan,
          status: "active",
          updated_at: now,
          created_at: now,
        },
        { merge: true },
      );

      res.json({ success: true });
      return;
    }

    if (action === "suspend_user") {
      if (userId === requester.uid) {
        sendError(res, 400, "You cannot suspend your own account");
        return;
      }

      await db.collection("profiles").doc(userId).set(
        {
          is_suspended: true,
          suspended_at: nowIso(),
          updated_at: nowIso(),
        },
        { merge: true },
      );

      await adminAuth.updateUser(userId, { disabled: true });
      res.json({ success: true });
      return;
    }

    if (action === "restore_user") {
      await db.collection("profiles").doc(userId).set(
        {
          is_suspended: false,
          suspended_at: null,
          updated_at: nowIso(),
        },
        { merge: true },
      );

      await adminAuth.updateUser(userId, { disabled: false });
      res.json({ success: true });
      return;
    }

    if (action === "delete_user") {
      if (userId === requester.uid) {
        sendError(res, 400, "You cannot delete your own account");
        return;
      }

      await deleteByUserId("leads", userId);
      await deleteByUserId("searches", userId);
      await db.collection("subscriptions").doc(userId).delete().catch(() => undefined);
      await db.collection("profiles").doc(userId).delete().catch(() => undefined);
      await adminAuth.deleteUser(userId);

      res.json({ success: true });
      return;
    }

    sendError(res, 400, "Unknown action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    sendError(res, 500, message);
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`map-leads-backend listening on :${PORT}`);
});
