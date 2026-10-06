// Simple CSRF protection — no external package required
// Generates a token per session, validates it on every state-changing POST/PUT/DELETE

import { randomBytes } from "crypto";

// Generate a new token and store in session
export function csrfMiddleware(req, res, next) {
  // Reinitialize session if null (happens after logout sets req.session = null)
  if (!req.session) req.session = {};
  // Generate token if not already set for this session
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("hex");
  }
  // Expose token to all views via res.locals
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

// Validate token on mutating requests
export function csrfProtect(req, res, next) {
  // Skip for GET, HEAD, OPTIONS
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  // Guard: session may be null after logout
  if (!req.session) return next();

  // Skip for public routes that have no session (self-registration, health check)
  if (req.path.endsWith("/self-register")) return next();

  const sessionToken = req.session.csrfToken;
  const bodyToken    = req.body._csrf || req.headers["x-csrf-token"];

  if (!sessionToken || !bodyToken || sessionToken !== bodyToken) {
    return res.status(403).render("403", {
      title:       "Forbidden",
      userName:    req.session?.userName    || "",
      userRole:    req.session?.userRole    || "",
      userInitial: (req.session?.userName  || "U")[0].toUpperCase(),
      isAdmin:     req.session?.userRole   === "admin",
      isJudge:     req.session?.userRole   === "judge",
      isEncoder:   req.session?.userRole   === "encoder",
      isOrganizer: req.session?.userRole   === "organizer",
    });
  }
  next();
}
