import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import crypto from "crypto";
import { z } from "zod";
import QueryStream from "pg-query-stream";
import { stringify } from "csv-stringify";
import { pipeline } from "stream";
import { pool, query } from "./db.js";
import { ensureSchema } from "./ensureSchema.js";
import { validateSubmissionLocation } from "./locationValidate.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_COOKIE_NAME = "admin_session";

app.use(helmet());

const isProd = process.env.NODE_ENV === "production";
const explicitOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (explicitOrigins.includes(origin)) return true;
  if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion. Reessayez plus tard." }
});

const submissionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de soumissions en peu de temps. Reessayez plus tard." }
});

app.use("/api/admin/login", loginLimiter);
app.use("/api/submissions", submissionLimiter);

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw), "utf8").digest("hex");
}

async function purgeExpiredSessions() {
  await query("DELETE FROM admin_sessions WHERE expires_at < NOW()");
}

async function appendAudit(req, action, meta = {}) {
  try {
    await query(
      `INSERT INTO admin_audit_log (action, ip, user_agent, meta) VALUES ($1, $2, $3, $4)`,
      [action, req.ip || "", String(req.get("user-agent") || ""), meta]
    );
  } catch (e) {
    console.error("Journal audit : ecriture impossible.", e?.message || e);
  }
}

function requireTrustedOrigin(req, res, next) {
  const origin = req.header("origin");
  if (!origin) return next();
  if (!isAllowedCorsOrigin(origin)) {
    return res.status(403).json({ error: "Origine non autorisee." });
  }
  next();
}

const submissionSchema = z
  .object({
    fullName: z
      .string()
      .max(120)
      .transform((s) =>
        String(s || "")
          .replace(/[\u0000-\u001F<>]/g, "")
          .trim()
      )
      .refine((s) => s.length >= 2, { message: "Nom invalide." }),
    phone: z
      .string()
      .transform((s) => String(s || "").replace(/\D/g, ""))
      .pipe(z.string().min(6).max(20)),
    email: z
      .string()
      .email()
      .max(120)
      .transform((s) => String(s || "").trim().toLowerCase()),
    status: z.enum(["etudiant", "employe", "entrepreneur", "autre", "chomeur"]),
    ageRange: z.enum(["15-24", "25-34", "35-44", "45+"]),
    gender: z.enum(["masculin", "feminin", "autre"]),
    province: z.string().min(2).max(100),
    cityOrTerritory: z.string().min(1).max(120),
    communeOrSector: z.string().min(1).max(200),
    quarter: z.string().max(200).optional().default(""),
    consentMethod: z.string().min(3).max(120),
    consentText: z.string().min(20).max(1200),
    consent: z.literal(true),
    turnstileToken: z.string().max(4000).optional().default("")
  })
  .superRefine((val, ctx) => {
    if (val.province === "Kinshasa" && !String(val.quarter || "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Le quartier est obligatoire pour Kinshasa.",
        path: ["quarter"]
      });
    }
  });

const requireAdmin = asyncHandler(async (req, res, next) => {
  const token = getCookie(req, ADMIN_COOKIE_NAME);
  if (!token) {
    return res.status(401).json({ error: "Acces admin refuse." });
  }
  const tokenHash = hashToken(token);
  const result = await query(
    "SELECT id, csrf_token FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()",
    [tokenHash]
  );
  if (!result.rows.length) {
    return res.status(401).json({ error: "Session admin invalide ou expiree." });
  }
  req.adminSessionId = result.rows[0].id;
  req.adminCsrfToken = result.rows[0].csrf_token;
  next();
});

function requireCsrf(req, res, next) {
  const headerRaw = String(req.header("x-csrf-token") || "");
  const secret = String(req.adminCsrfToken || "");
  const a = Buffer.from(headerRaw, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return res.status(403).json({ error: "CSRF invalide." });
  }
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "CSRF invalide." });
  }
  next();
}

function getCookie(req, name) {
  const raw = req.headers?.cookie || "";
  if (!raw) return "";
  const items = raw.split(";").map((v) => v.trim());
  for (const item of items) {
    const idx = item.indexOf("=");
    if (idx <= 0) continue;
    const key = item.slice(0, idx);
    if (key !== name) continue;
    const val = item.slice(idx + 1);
    try {
      return decodeURIComponent(val);
    } catch {
      return val;
    }
  }
  return "";
}

function setAdminSessionCookie(res, sessionToken) {
  const maxAgeSec = 60 * 60 * 12;
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearAdminSessionCookie(res) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function verifyTurnstile(token, remoteip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token || String(token).length < 10) return false;
  const body = new URLSearchParams({
    secret,
    response: String(token),
    remoteip: remoteip || ""
  });
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await r.json().catch(() => ({}));
  return data.success === true;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post(
  "/api/admin/login",
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      console.warn("Echec login admin", { ip: req.ip });
      return res.status(401).json({ error: "Identifiants invalides." });
    }

    await purgeExpiredSessions();

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const csrfToken = crypto.randomBytes(24).toString("hex");
    const tokenHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12);

    await query(
      `INSERT INTO admin_sessions (token_hash, csrf_token, expires_at) VALUES ($1, $2, $3)`,
      [tokenHash, csrfToken, expiresAt.toISOString()]
    );

    setAdminSessionCookie(res, sessionToken);
    await appendAudit(req, "login", {});
    console.log("Connexion admin reussie", { ip: req.ip });

    return res.json({ ok: true });
  })
);

app.post(
  "/api/admin/logout",
  requireTrustedOrigin,
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const token = getCookie(req, ADMIN_COOKIE_NAME);
    if (token) {
      await query("DELETE FROM admin_sessions WHERE token_hash = $1", [hashToken(token)]);
    }
    clearAdminSessionCookie(res);
    await appendAudit(req, "logout", {});
    return res.json({ ok: true });
  })
);

app.get(
  "/api/admin/session",
  requireTrustedOrigin,
  requireAdmin,
  (_req, res) => {
    return res.json({ ok: true });
  }
);

app.get(
  "/api/admin/csrf",
  requireTrustedOrigin,
  requireAdmin,
  (req, res) => {
    return res.json({ csrfToken: req.adminCsrfToken });
  }
);

app.post(
  "/api/submissions",
  asyncHandler(async (req, res) => {
    if (String(req.body?.website || "").trim()) {
      return res.status(400).json({ error: "Soumission refusee." });
    }

    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const fieldErrors = flat.fieldErrors || {};
      const firstField = Object.keys(fieldErrors)[0];
      const firstMsg = firstField ? fieldErrors[firstField]?.[0] : null;
      const payload = {
        error: firstMsg || "Donnees invalides. Verifiez les champs du formulaire."
      };
      if (!isProd) payload.details = flat;
      return res.status(400).json(payload);
    }

    if (process.env.TURNSTILE_SECRET_KEY) {
      const ip = req.ip || req.socket?.remoteAddress || "";
      const ok = await verifyTurnstile(parsed.data.turnstileToken, ip);
      if (!ok) {
        return res.status(400).json({ error: "Verification anti-robot echouee. Reessayez." });
      }
    }

    const locErr = validateSubmissionLocation(parsed.data);
    if (locErr) {
      return res.status(400).json({ error: locErr });
    }

    const data = parsed.data;
    const quarterVal =
      data.province === "Kinshasa" ? String(data.quarter || "").trim() : null;

    try {
      await query(
        `INSERT INTO submissions 
      (full_name, phone, email, status, age_range, gender, province, city_or_territory, commune_or_sector, quarter, consent, consent_method, consent_text, consent_accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
        [
          data.fullName,
          data.phone,
          data.email,
          data.status,
          data.ageRange,
          data.gender,
          data.province,
          data.cityOrTerritory,
          data.communeOrSector,
          quarterVal,
          data.consent,
          data.consentMethod,
          data.consentText
        ]
      );
    } catch (err) {
      if (err?.code === "23505") {
        const detail = String(err?.detail || "").toLowerCase();
        const constraint = String(err?.constraint || "").toLowerCase();
        const isEmail =
          constraint === "submissions_email_unique" || detail.includes("(email)");
        const isPhone =
          constraint === "submissions_phone_unique" || detail.includes("(phone)");
        if (isEmail) {
          return res.status(409).json({
            error:
              "Cette adresse e-mail est deja enregistree. Utilisez une autre adresse e-mail pour soumettre une nouvelle inscription."
          });
        }
        if (isPhone) {
          return res.status(409).json({
            error:
              "Ce numero de telephone est deja enregistre. Utilisez un autre numero pour soumettre une nouvelle inscription."
          });
        }
        return res.status(409).json({
          error: "Ces informations correspondent deja a une inscription existante."
        });
      }
      if (err?.code !== "42P01" && err?.code !== "23505") console.error(err);
      if (err?.code === "42P01") {
        return res.status(500).json({
          error: isProd
            ? "Erreur serveur lors de l'enregistrement."
            : "La table submissions n'existe pas. Dans le dossier backend, executez : npm run db:init (applique src/schema.sql sur la base definie par DATABASE_URL)."
        });
      }
      if (err?.code === "42703" || err?.code === "23502") {
        return res.status(500).json({
          error: isProd
            ? "Erreur serveur lors de l'enregistrement."
            : "Base de donnees non a jour : executez backend/src/schema.sql (nouvelle base) ou backend/src/migration_add_location_columns.sql (base existante), puis redemarrez le serveur."
        });
      }
      if (err?.code === "ECONNREFUSED" || err?.code === "ENOTFOUND") {
        return res.status(500).json({
          error:
            "Impossible de joindre PostgreSQL. Verifiez DATABASE_URL et que le serveur SQL est demarre."
        });
      }
      return res.status(500).json({ error: "Erreur serveur lors de l'enregistrement." });
    }

    return res.status(201).json({ message: "Soumission enregistree." });
  })
);

app.get(
  "/api/admin/submissions",
  requireTrustedOrigin,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const offset = (page - 1) * limit;

    const filters = [];
    const values = [];
    let i = 1;

    const addFilter = (field, value) => {
      if (!value) return;
      filters.push(`${field} = $${i++}`);
      values.push(value);
    };

    addFilter("age_range", req.query.ageRange);
    addFilter("province", req.query.province);
    addFilter("gender", req.query.gender);
    addFilter("status", req.query.status);

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*)::BIGINT AS total FROM submissions ${whereClause}`;
    const listSql = `
    SELECT id, full_name, phone, email, status, age_range, gender, province, city_or_territory, commune_or_sector, quarter, consent, consent_method, consent_text, consent_accepted_at, created_at
    FROM submissions
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT $${i++} OFFSET $${i++}
  `;

    const countResult = await query(countSql, values);
    const listResult = await query(listSql, [...values, limit, offset]);

    res.json({
      data: listResult.rows,
      pagination: {
        page,
        limit,
        total: Number(countResult.rows[0].total)
      }
    });
  })
);

app.get(
  "/api/admin/submissions/export.csv",
  requireTrustedOrigin,
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    await appendAudit(req, "export_csv", {
      ageRange: req.query.ageRange || null,
      province: req.query.province || null,
      gender: req.query.gender || null,
      status: req.query.status || null
    });

    const filters = [];
    const values = [];
    let i = 1;

    const addFilter = (field, value) => {
      if (!value) return;
      filters.push(`${field} = $${i++}`);
      values.push(value);
    };

    addFilter("age_range", req.query.ageRange);
    addFilter("province", req.query.province);
    addFilter("gender", req.query.gender);
    addFilter("status", req.query.status);

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const sql = `
    SELECT id, full_name, phone, email, status, age_range, gender, province, city_or_territory, commune_or_sector, quarter, consent, consent_method, consent_text, consent_accepted_at, created_at
    FROM submissions
    ${whereClause}
    ORDER BY created_at DESC, id DESC
  `;

    const client = await pool.connect();
    try {
      const stream = new QueryStream(sql, values, { batchSize: 10000 });
      const dbStream = client.query(stream);
      const csvStream = stringify({
        header: true,
        columns: [
          "id",
          "full_name",
          "phone",
          "email",
          "status",
          "age_range",
          "gender",
          "province",
          "city_or_territory",
          "commune_or_sector",
          "quarter",
          "consent",
          "consent_method",
          "consent_text",
          "consent_accepted_at",
          "created_at"
        ]
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="submissions-${Date.now()}.csv"`
      );

      pipeline(dbStream, csvStream, res, (err) => {
        client.release();
        if (err) {
          console.error(err);
        }
      });
    } catch (error) {
      client.release();
      throw error;
    }
  })
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur serveur." });
});

async function start() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error(
      "ADMIN_USERNAME et ADMIN_PASSWORD sont obligatoires dans backend/.env (suppression des identifiants par defaut pour la securite)."
    );
    process.exit(1);
  }

  try {
    await ensureSchema();
  } catch (err) {
    console.error("Impossible d'appliquer le schema SQL sur PostgreSQL :", err?.message || err);
    console.error(
      "Verifiez DATABASE_URL dans backend/.env (base creee, mot de passe). Ou desactivez l'auto-schema : SKIP_AUTO_SCHEMA=1 et lancez : npm run db:init"
    );
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Backend en ecoute sur http://localhost:${PORT}`);
  });
}

start();
