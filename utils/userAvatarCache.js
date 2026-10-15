const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

const avatarCache = new Map();
const pendingLoads = new Map();
let cacheBytes = 0;

function removeCachedAvatar(userId) {
  const entry = avatarCache.get(userId);
  if (!entry) return;
  cacheBytes -= entry.size;
  avatarCache.delete(userId);
}

export function setCachedUserAvatar(userId, avatar) {
  if (!userId || typeof avatar !== "string") return;

  removeCachedAvatar(userId);
  const size = avatar.length * 2;
  if (size > MAX_CACHE_BYTES) return;

  avatarCache.set(userId, {
    avatar,
    expiresAt: Date.now() + CACHE_TTL_MS,
    size,
  });
  cacheBytes += size;

  while (avatarCache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
    removeCachedAvatar(avatarCache.keys().next().value);
  }
}

export async function getCachedUserAvatar(userId, loadAvatar) {
  const cached = avatarCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    avatarCache.delete(userId);
    avatarCache.set(userId, cached);
    return cached.avatar;
  }
  if (cached) removeCachedAvatar(userId);

  const pending = pendingLoads.get(userId);
  if (pending) return pending;

  const load = (async () => {
    const avatar = await loadAvatar();
    setCachedUserAvatar(userId, avatar);
    return avatar;
  })();
  pendingLoads.set(userId, load);

  try {
    return await load;
  } finally {
    if (pendingLoads.get(userId) === load) pendingLoads.delete(userId);
  }
}
