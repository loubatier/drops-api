import { z } from 'zod';

export interface Config {
  port: number;
  databasePath: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  adminKey: string;
  zone: { lat: number; lng: number; radiusM: number };
  bboxMaxPageSize: number;
  wsTicketTtlSeconds: number;
  wsMaxConnectionsPerUser: number;
  wsMessagesPer10s: number;
  simulatorEnabled: boolean;
  simulatorIntervalSeconds: number;
  enableSimulation: boolean;
  reportHideThreshold: number;
  rateLimit: { read: number; write: number; auth: number };
  seedOnEmpty: boolean;
  commit: string | null;
  logRequests: boolean;
}

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const int = (def: number, min = 1) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).default(def));

const bool = (def: boolean) =>
  z.preprocess(
    emptyToUndefined,
    z
      .enum(['true', 'false'])
      .default(def ? 'true' : 'false')
      .transform((v) => v === 'true'),
  );

const envSchema = z.object({
  PORT: int(4000),
  DATABASE_PATH: z.preprocess(emptyToUndefined, z.string().default('./data/drops.db')),
  JWT_SECRET: z.string({ required_error: 'obligatoire' }).min(32, 'au moins 32 caractères'),
  JWT_TTL_SECONDS: int(28800, 10),
  ADMIN_KEY: z.string({ required_error: 'obligatoire' }).min(1, 'obligatoire'),
  ZONE_CENTER: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default('47.495472,6.805279')
      .refine((v) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(v.trim()), 'format attendu : lat,lng'),
  ),
  ZONE_RADIUS_M: int(3000),
  BBOX_MAX_PAGE_SIZE: int(200),
  WS_TICKET_TTL_SECONDS: int(30),
  WS_MAX_CONNECTIONS_PER_USER: int(5),
  WS_MESSAGES_PER_10S: int(20),
  SIMULATOR_ENABLED: bool(false),
  SIMULATOR_INTERVAL_SECONDS: int(20),
  ENABLE_SIMULATION: bool(true),
  REPORT_HIDE_THRESHOLD: int(3),
  RATE_LIMIT_READ_PER_MIN: int(600),
  RATE_LIMIT_WRITE_PER_MIN: int(60),
  RATE_LIMIT_AUTH_PER_MIN: int(60),
  SEED_ON_EMPTY: bool(true),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const [lat, lng] = e.ZONE_CENTER.split(',').map((n) => Number(n.trim())) as [number, number];
  const commit = env.COMMIT_SHA ?? env.RAILWAY_GIT_COMMIT_SHA ?? env.SOURCE_VERSION ?? null;
  return {
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    jwtSecret: e.JWT_SECRET,
    jwtTtlSeconds: e.JWT_TTL_SECONDS,
    adminKey: e.ADMIN_KEY,
    zone: { lat, lng, radiusM: e.ZONE_RADIUS_M },
    bboxMaxPageSize: e.BBOX_MAX_PAGE_SIZE,
    wsTicketTtlSeconds: e.WS_TICKET_TTL_SECONDS,
    wsMaxConnectionsPerUser: e.WS_MAX_CONNECTIONS_PER_USER,
    wsMessagesPer10s: e.WS_MESSAGES_PER_10S,
    simulatorEnabled: e.SIMULATOR_ENABLED,
    simulatorIntervalSeconds: e.SIMULATOR_INTERVAL_SECONDS,
    enableSimulation: e.ENABLE_SIMULATION,
    reportHideThreshold: e.REPORT_HIDE_THRESHOLD,
    rateLimit: {
      read: e.RATE_LIMIT_READ_PER_MIN,
      write: e.RATE_LIMIT_WRITE_PER_MIN,
      auth: e.RATE_LIMIT_AUTH_PER_MIN,
    },
    seedOnEmpty: e.SEED_ON_EMPTY,
    commit: commit ? commit.slice(0, 7) : null,
    logRequests: env.NODE_ENV !== 'test',
  };
}
