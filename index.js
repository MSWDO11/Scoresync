import express from "express";
import path from "path";
import session from "express-session";
import flash from "connect-flash";
import router from "./routes/index.js";
import fs from "fs";
import hbs from "hbs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { injectUser } from "./middleware/auth.js";
import { db } from "./models/firebaseConfig.js";
import { collection, getDocs } from "firebase/firestore";
import { applyAutoStatus } from "./utils/autoStatus.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Body / Static ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "public")));

// ─── Session & Flash ──────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || "scoresync-secret-2026",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
}));
app.use(flash());

// ─── Flash + user data into all views ────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg")[0] || "";
  res.locals.error_msg   = req.flash("error_msg")[0]   || "";
  next();
});
app.use(injectUser);

// ─── Handlebars helpers ───────────────────────────────────────────────────────
hbs.registerHelper("eq",  (a, b) => a === b);
hbs.registerHelper("gt",  (a, b) => Number(a) > Number(b));
hbs.registerHelper("gte", (a, b) => Number(a) >= Number(b));
hbs.registerHelper("lt",  (a, b) => Number(a) < Number(b));
hbs.registerHelper("lte", (a, b) => Number(a) <= Number(b));
hbs.registerHelper("not", (a)    => !a);
hbs.registerHelper("add1",(a)    => Number(a) + 1);
hbs.registerHelper("sub1",(a)    => Number(a) - 1);

// Theme → gradient mapping for event cards
const THEME_GRADIENTS = {
  blue:   "linear-gradient(135deg,#1e3a8a,#2563eb)",
  purple: "linear-gradient(135deg,#4c1d95,#7c3aed)",
  green:  "linear-gradient(135deg,#064e3b,#059669)",
  gold:   "linear-gradient(135deg,#92400e,#d97706)",
  rose:   "linear-gradient(135deg,#881337,#e11d48)",
  slate:  "linear-gradient(135deg,#1e293b,#475569)",
};
hbs.registerHelper("themeGradient", (theme) =>
  THEME_GRADIENTS[theme] || THEME_GRADIENTS.blue
);

// Criteria colour by index (used in scoring pages)
const CRITERIA_COLORS = ["#2563eb","#7c3aed","#059669","#dc2626","#d97706","#0891b2","#be185d","#65a30d"];
hbs.registerHelper("criteriaColor", (idx) => CRITERIA_COLORS[Number(idx) % CRITERIA_COLORS.length]);

// ─── .xian engine (wraps hbs) ────────────────────────────────────────────────
app.engine("xian", (filePath, options, callback) => {
  const originalPartialsDir = hbs.partialsDir;
  hbs.partialsDir = path.join(__dirname, "views");

  hbs.__express(filePath, options, (err, html) => {
    hbs.partialsDir = originalPartialsDir;
    if (err) {
      console.error("Template rendering error on file:", filePath, err);
      return callback(err);
    }
    callback(null, html);
  });
});

app.set("views",       path.join(__dirname, "views"));
app.set("view engine", "xian");

// ─── Auto-register all partials recursively ───────────────────────────────────
function registerPartials(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      registerPartials(fullPath);
    } else if (file.endsWith(".xian")) {
      const name    = file.replace(".xian", "");
      const content = fs.readFileSync(fullPath, "utf8");
      hbs.registerPartial(name, content);
    }
  });
}
registerPartials(path.join(__dirname, "views", "partials"));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/", router);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send(`
    <div style="font-family:sans-serif;text-align:center;padding:80px">
      <h1 style="font-size:4rem;color:#1e3a5f">404</h1>
      <p>Page not found.</p>
      <a href="/" style="color:#2563eb">Go Home</a>
    </div>
  `);
});

export default app;

// ─── Background status poller — runs every 60s ───────────────────────────────
async function pollEventStatuses() {
  try {
    const snap = await getDocs(collection(db, "events"));
    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await Promise.all(
      events
        .filter(e => e.date && e.status !== 'cancelled')
        .map(e => applyAutoStatus(e.id, e))
    );
  } catch (err) {
    console.error("Status poll error:", err.message);
  }
}

if (!process.env.ELECTRON) {
  app.listen(PORT, () => {
    console.log(`🏆 ScoreSync running at http://localhost:${PORT}`);
    // Start background poller immediately, then every 60 seconds
    pollEventStatuses();
    setInterval(pollEventStatuses, 60 * 1000);
  });
}
