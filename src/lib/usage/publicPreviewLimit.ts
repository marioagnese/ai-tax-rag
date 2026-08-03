import { redis } from "./redis";

type PublicPreviewLimitMeta = {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
  key: string;
  clientId: string;
};

function sha1Like(input: string) {
  let h = 0;

  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }

  return h.toString(16).padStart(8, "0");
}

export function getPublicPreviewClientId(
  req: Request
) {
  const ip =
    req.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "0.0.0.0";

  const userAgent =
    req.headers.get("user-agent") || "";

  return `public:${ip}:${sha1Like(userAgent)}`;
}

function utcDayKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(
    now.getUTCMonth() + 1
  ).padStart(2, "0");
  const day = String(
    now.getUTCDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function endOfUtcDay(now = new Date()) {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0
    )
  );
}

export async function assertPublicPreviewAvailable(
  req: Request
) {
  const limit = 1;
  const clientId =
    getPublicPreviewClientId(req);
  const reset = endOfUtcDay();
  const day = utcDayKey();

  const key =
    `taxaipro:public-preview:${day}:${clientId}`;

  const used = await redis.incr(key);

  const ttlSeconds = Math.max(
    60,
    Math.floor(
      (reset.getTime() - Date.now()) /
        1000
    )
  );

  await redis.expire(key, ttlSeconds);

  const remaining = Math.max(
    0,
    limit - used
  );

  const meta: PublicPreviewLimitMeta = {
    limit,
    used,
    remaining,
    resetAt: reset.toISOString(),
    key,
    clientId,
  };

  if (used > limit) {
    const error = new Error(
      "PUBLIC_LIMIT_REACHED"
    ) as Error & {
      status?: number;
      meta?: PublicPreviewLimitMeta;
    };

    error.status = 429;
    error.meta = meta;

    throw error;
  }

  return meta;
}

export type {
  PublicPreviewLimitMeta,
};
