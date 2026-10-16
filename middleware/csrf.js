import { randomBytes, timingSafeEqual } from "crypto";

export function csrfMiddleware(req, res, next) {
  if (!req.session) req.session = {};
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

export function csrfProtect(req, res, next) {
  const isVoteMutation =
    req.method === "POST" &&
    /^\/events\/[^/]+\/vote(?:\/toggle)?\/?$/.test(req.path);
  if (!isVoteMutation) return next();

  const expected = req.session?.csrfToken;
  const submitted = req.body?._csrf || req.get("x-csrf-token");
  if (
    typeof expected !== "string" ||
    !/^[a-f0-9]{64}$/i.test(expected) ||
    typeof submitted !== "string" ||
    !/^[a-f0-9]{64}$/i.test(submitted) ||
    !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(submitted, "hex"))
  ) {
    return res.status(403).send("Invalid or missing CSRF token.");
  }

  next();
}
