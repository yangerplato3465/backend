import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the app needs, declared once.
 *
 * Why validate env at all? Because the alternative is `process.env.PORT` being
 * `undefined` at 3am in production and failing somewhere far away from the cause.
 * Validating here means a misconfigured deploy dies instantly at boot with a clear
 * message — which is exactly what you want Kubernetes to see, because a pod that
 * crashes immediately never becomes "ready" and never receives traffic.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Not connected until Phase 1/2, but declared now so a broken deploy fails at
  // boot rather than on the first request that happens to need a database.
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    // Deliberately console.error, not the app logger: the logger is configured
    // from env, and env is what just failed.
    console.error(`Invalid environment configuration:\n${details}`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
