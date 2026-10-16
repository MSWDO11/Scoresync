// CSRF middleware — disabled (causes session conflicts with cookie-session)
// Re-enable only when using a server-side session store (e.g. Redis)

export function csrfMiddleware(req, res, next) {
  res.locals.csrfToken = "";
  next();
}

export function csrfProtect(req, res, next) {
  next();
}
