import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../firebase/admin";

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
    h =
      (h * 31 + input.charCodeAt(i)) >>>
      0;
  }

  return h
    .toString(16)
    .padStart(8, "0");
}

export function getPublicPreviewClientId(
  req: Request
) {
  const ip =
    req.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim() ||
    req.headers
      .get("x-real-ip")
      ?.trim() ||
    "0.0.0.0";

  const userAgent =
    req.headers.get("user-agent") || "";

  return `public:${ip}:${sha1Like(
    userAgent
  )}`;
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
  const key = `${day}:${clientId}`;

  const db = getAdminDb();
  const ref = db
    .collection("publicPreviewUsage")
    .doc(sha1Like(key));

  const meta =
    await db.runTransaction(
      async (transaction) => {
        const snapshot =
          await transaction.get(ref);

        const currentUsed =
          snapshot.exists
            ? Number(
                snapshot.data()?.used || 0
              )
            : 0;

        const used = currentUsed + 1;
        const remaining = Math.max(
          0,
          limit - used
        );

        const result: PublicPreviewLimitMeta =
          {
            limit,
            used,
            remaining,
            resetAt:
              reset.toISOString(),
            key,
            clientId,
          };

        transaction.set(
          ref,
          {
            used,
            clientId,
            day,
            resetAt:
              reset.toISOString(),
            updatedAt:
              FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return result;
      }
    );

  if (meta.used > limit) {
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
