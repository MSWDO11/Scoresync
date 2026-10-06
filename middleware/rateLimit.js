// In-memory rate limiter — no external package required
// Tracks failed login attempts per IP and blocks after threshold

const attempts = new Map(); // ip -> { count, firstAt, blockedUntil }

const MAX_ATTEMPTS  = 10;          // max failed attempts before block
const WINDOW_MS     = 15 * 60 * 1000; // 15-minute window
const BLOCK_MS      = 30 * 60 * 1000; // 30-minute block after threshold

// Clean up stale entries every 10 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of attempts.entries()) {
    if (now - data.firstAt > BLOCK_MS) attempts.delete(ip);
  }
}, 10 * 60 * 1000);

export function loginRateLimit(req, res, next) {
  const ip  = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const rec = attempts.get(ip);

  if (rec) {
    // Currently blocked
    if (rec.blockedUntil && now < rec.blockedUntil) {
      const minsLeft = Math.ceil((rec.blockedUntil - now) / 60000);
      req.flash("error_msg", `Too many failed login attempts. Try again in ${minsLeft} minute(s).`);
      return res.redirect("/login");
    }
    // Window expired — reset
    if (now - rec.firstAt > WINDOW_MS) {
      attempts.delete(ip);
    }
  }

  next();
}

export function recordFailedLogin(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, firstAt: now, blockedUntil: null };

  // Reset window if expired
  if (now - rec.firstAt > WINDOW_MS) {
    rec.count   = 0;
    rec.firstAt = now;
    rec.blockedUntil = null;
  }

  rec.count++;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.blockedUntil = now + BLOCK_MS;
  }
  attempts.set(ip, rec);
}

export function clearFailedLogins(ip) {
  attempts.delete(ip);
}
