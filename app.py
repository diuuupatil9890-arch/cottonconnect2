import os
import re
import sqlite3
from datetime import date, timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = Path(__file__).parent
DB_PATH = BASE / "cottonconnect.db"
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-before-deploying")

HASH = "pbkdf2:sha256"
CATS = ["Raw Cotton", "Processed Cotton", "Cotton Bales", "Others"]
PARTY = {"suppliers": "purchases", "customers": "sales"}  # party table -> its transaction table
TXN = {"purchases": "suppliers", "sales": "customers"}    # transaction table -> party table

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, business_name TEXT NOT NULL,
  mobile TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, city TEXT NOT NULL, state TEXT NOT NULL,
  gstin TEXT, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, city TEXT);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, city TEXT);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, party_id INTEGER NOT NULL,
  date TEXT NOT NULL, category TEXT NOT NULL, qty_kg REAL NOT NULL, rate REAL NOT NULL);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, party_id INTEGER NOT NULL,
  date TEXT NOT NULL, category TEXT NOT NULL, qty_kg REAL NOT NULL, rate REAL NOT NULL);
"""


# ---------- database helpers ----------
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_):
    c = g.pop("db", None)
    if c is not None:
        c.close()


def rows(sql, *a):
    return [dict(r) for r in db().execute(sql, a).fetchall()]


def one(sql, *a):
    r = db().execute(sql, a).fetchone()
    return r[0] if r else None


with sqlite3.connect(DB_PATH) as _c:
    _c.executescript(SCHEMA)


# ---------- validation ----------
RULES = {
    "full_name": (lambda v: len(v) >= 3, "Enter your full name."),
    "business_name": (lambda v: len(v) >= 2, "Enter your business name."),
    "mobile": (lambda v: re.fullmatch(r"[6-9]\d{9}", v), "Enter a 10-digit mobile number."),
    "email": (lambda v: re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v), "Enter a valid email address."),
    "city": (lambda v: len(v) >= 2, "Enter your city."),
    "state": (lambda v: bool(v), "Select your state."),
    "gstin": (lambda v: not v or re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]", v.upper()),
              "GSTIN must be 15 characters, like 27ABCDE1234F1Z5."),
    "password": (lambda v: len(v) >= 8 and re.search(r"\d", v) and re.search(r"[A-Za-z]", v),
                 "Use 8+ characters with letters and numbers."),
}


def check(d, keys):
    val = lambda k: str(d.get(k, "")) if k == "password" else str(d.get(k, "")).strip()
    return {k: RULES[k][1] for k in keys if not RULES[k][0](val(k))}


def pos(v):
    try:
        x = float(v)
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def pub(u):
    return {k: u[k] for k in ("full_name", "business_name", "mobile", "email", "city", "state")}


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **k):
        uid = session.get("uid")
        row = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone() if uid else None
        if row is None:
            session.clear()
            return jsonify(ok=False, error="Sign in first."), 401
        g.uid, g.user = row["id"], row
        return fn(*a, **k)
    return wrapper


# ---------- pages and auth ----------
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/register")
def register():
    d = request.get_json(silent=True) or {}
    errs = check(d, ["full_name", "business_name", "mobile", "email", "city", "state", "gstin", "password"])
    if errs:
        return jsonify(ok=False, errors=errs), 400
    s = lambda k: str(d.get(k, "")).strip()
    try:
        cur = db().execute(
            """INSERT INTO users (full_name, business_name, mobile, email, city, state, gstin, password_hash)
               VALUES (?,?,?,?,?,?,?,?)""",
            (s("full_name"), s("business_name"), s("mobile"), s("email").lower(), s("city"), s("state"),
             s("gstin").upper() or None, generate_password_hash(str(d["password"]), method=HASH)))
        db().commit()
    except sqlite3.IntegrityError as exc:
        f = "mobile" if "mobile" in str(exc) else "email"
        return jsonify(ok=False, errors={f: f"This {'mobile number' if f == 'mobile' else 'email'} is already registered."}), 409
    session["uid"] = cur.lastrowid
    return jsonify(ok=True, user=pub(db().execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone())), 201


@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    ident = str(d.get("identifier", "")).strip().lower()
    row = db().execute("SELECT * FROM users WHERE mobile=? OR email=?", (ident, ident)).fetchone()
    if row is None or not check_password_hash(row["password_hash"], str(d.get("password", ""))):
        return jsonify(ok=False, errors={"password": "Mobile, email or password is incorrect."}), 401
    session["uid"] = row["id"]
    return jsonify(ok=True, user=pub(row))


@app.post("/api/logout")
def logout():
    session.clear()
    session["out"] = True
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    if not session.get("uid") and AUTO_LOGIN and not session.get("out"):
        session["uid"] = ensure_demo_user()
    return login_required(lambda: jsonify(ok=True, user=pub(g.user)))()


@app.post("/api/profile")
@login_required
def profile():
    d = request.get_json(silent=True) or {}
    keys = ["full_name", "business_name", "city", "state"]
    errs = check(d, keys)
    if errs:
        return jsonify(ok=False, errors=errs), 400
    db().execute("UPDATE users SET full_name=?, business_name=?, city=?, state=? WHERE id=?",
                 (*[str(d[k]).strip() for k in keys], g.uid))
    db().commit()
    return jsonify(ok=True)


@app.post("/api/password")
@login_required
def password():
    d = request.get_json(silent=True) or {}
    if not check_password_hash(g.user["password_hash"], str(d.get("current", ""))):
        return jsonify(ok=False, errors={"current": "Current password is incorrect."}), 400
    errs = check({"password": d.get("new", "")}, ["password"])
    if errs:
        return jsonify(ok=False, errors={"new": errs["password"]}), 400
    db().execute("UPDATE users SET password_hash=? WHERE id=?",
                 (generate_password_hash(str(d["new"]), method=HASH), g.uid))
    db().commit()
    return jsonify(ok=True)


# ---------- suppliers, customers, purchases, sales ----------
@app.get("/api/e/<ent>")
@login_required
def ent_list(ent):
    if ent in PARTY:
        return jsonify(ok=True, items=rows(f"SELECT id, name, phone, city FROM {ent} WHERE user_id=? ORDER BY name", g.uid))
    if ent in TXN:
        return jsonify(ok=True, items=rows(
            f"""SELECT t.id, t.date, t.category, t.qty_kg, t.rate, t.qty_kg*t.rate AS total, p.name AS party
                FROM {ent} t JOIN {TXN[ent]} p ON p.id = t.party_id
                WHERE t.user_id=? ORDER BY t.date DESC, t.id DESC""", g.uid))
    return jsonify(ok=False), 404


@app.post("/api/e/<ent>")
@login_required
def ent_add(ent):
    d = request.get_json(silent=True) or {}
    s = lambda k: str(d.get(k, "")).strip()
    e = {}
    if ent in PARTY:
        if len(s("name")) < 2:
            e["name"] = "Enter a name."
        if s("phone") and not re.fullmatch(r"\d{10}", s("phone")):
            e["phone"] = "Enter a 10-digit phone number."
        if e:
            return jsonify(ok=False, errors=e), 400
        db().execute(f"INSERT INTO {ent} (user_id, name, phone, city) VALUES (?,?,?,?)",
                     (g.uid, s("name"), s("phone") or None, s("city") or None))
    elif ent in TXN:
        if one(f"SELECT 1 FROM {TXN[ent]} WHERE id=? AND user_id=?", s("party_id") or 0, g.uid) is None:
            e["party_id"] = "Select from the list."
        try:
            date.fromisoformat(s("date"))
        except ValueError:
            e["date"] = "Choose a date."
        if s("category") not in CATS:
            e["category"] = "Select a category."
        qty, rate = pos(s("qty_kg")), pos(s("rate"))
        if qty is None:
            e["qty_kg"] = "Enter a quantity above zero."
        if rate is None:
            e["rate"] = "Enter a rate above zero."
        if e:
            return jsonify(ok=False, errors=e), 400
        db().execute(f"INSERT INTO {ent} (user_id, party_id, date, category, qty_kg, rate) VALUES (?,?,?,?,?,?)",
                     (g.uid, int(s("party_id")), s("date"), s("category"), qty, rate))
    else:
        return jsonify(ok=False), 404
    db().commit()
    return jsonify(ok=True), 201


@app.delete("/api/e/<ent>/<int:item_id>")
@login_required
def ent_del(ent, item_id):
    if ent not in PARTY and ent not in TXN:
        return jsonify(ok=False), 404
    if ent in PARTY and one(f"SELECT 1 FROM {PARTY[ent]} WHERE party_id=? AND user_id=?", item_id, g.uid):
        return jsonify(ok=False, error="This party has transactions. Delete those first."), 409
    cur = db().execute(f"DELETE FROM {ent} WHERE id=? AND user_id=?", (item_id, g.uid))
    db().commit()
    return jsonify(ok=cur.rowcount == 1), (200 if cur.rowcount else 404)


# ---------- dashboard ----------
@app.get("/api/summary")
@login_required
def summary():
    today = date.today()
    ym = today.strftime("%Y-%m")
    prev = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

    def month(t, m):
        return one(f"SELECT COALESCE(SUM(qty_kg*rate),0) FROM {t} WHERE user_id=? AND substr(date,1,7)=?", g.uid, m)

    def series(t):
        out = [0] * 12
        for r in rows(f"""SELECT CAST(substr(date,6,2) AS INTEGER) AS m, SUM(qty_kg*rate) AS v FROM {t}
                          WHERE user_id=? AND substr(date,1,4)=? GROUP BY m""", g.uid, str(today.year)):
            out[r["m"] - 1] = r["v"]
        return out

    pct = lambda a, b: round((a - b) / b * 100) if b else None
    recent = lambda t: rows(
        f"""SELECT t.id, t.date, p.name AS party, t.qty_kg, t.rate, t.qty_kg*t.rate AS total
            FROM {t} t JOIN {TXN[t]} p ON p.id = t.party_id
            WHERE t.user_id=? ORDER BY t.date DESC, t.id DESC LIMIT 5""", g.uid)
    stock = []
    for c in CATS:
        b = one("SELECT COALESCE(SUM(qty_kg),0) FROM purchases WHERE user_id=? AND category=?", g.uid, c)
        s = one("SELECT COALESCE(SUM(qty_kg),0) FROM sales WHERE user_id=? AND category=?", g.uid, c)
        stock.append(dict(category=c, purchased=b, sold=s, available=max(0, b - s)))
    pm, sm = month("purchases", ym), month("sales", ym)
    return jsonify(
        ok=True, month=today.month, year=today.year,
        purchases_month=pm, sales_month=sm,
        purchases_pct=pct(pm, month("purchases", prev)), sales_pct=pct(sm, month("sales", prev)),
        stock_kg=sum(c["available"] for c in stock), stock=stock,
        suppliers=one("SELECT COUNT(*) FROM suppliers WHERE user_id=?", g.uid),
        customers=one("SELECT COUNT(*) FROM customers WHERE user_id=?", g.uid),
        monthly_purchases=series("purchases"), monthly_sales=series("sales"),
        recent_purchases=recent("purchases"), recent_sales=recent("sales"))


def seed(c, uid):
    """Fill an account with example data that mirrors the CottonConnect mockup."""
    today = date.today()

    def add(t, names):
        return [c.execute(f"INSERT INTO {t} (user_id, name) VALUES (?,?)", (uid, n)).lastrowid for n in names]

    sup = add("suppliers", ["Shree Cotton Traders", "Patel Agro Suppliers", "Rajesh Cotton Co.", "Sai Traders", "Global Cotton Ltd."])
    cus = add("customers", ["Krishna Textiles", "Omkar Mills", "Sai Fabrics", "Maa Durga Textiles", "Vijay Enterprises"])
    recent_p = [(0, 6, "Raw Cotton", 1000, 62), (1, 10, "Raw Cotton", 800, 60), (2, 14, "Processed Cotton", 1200, 58),
                (3, 18, "Cotton Bales", 750, 61), (4, 23, "Raw Cotton", 900, 59)]
    recent_s = [(0, 4, "Raw Cotton", 600, 68), (1, 8, "Processed Cotton", 1000, 67), (2, 12, "Raw Cotton", 750, 66),
                (3, 16, "Cotton Bales", 900, 65), (4, 20, "Raw Cotton", 500, 64)]
    for i, days, cat, q, r in recent_p:
        c.execute("INSERT INTO purchases (user_id, party_id, date, category, qty_kg, rate) VALUES (?,?,?,?,?,?)",
                  (uid, sup[i], (today - timedelta(days=days)).isoformat(), cat, q, r))
    for i, days, cat, q, r in recent_s:
        c.execute("INSERT INTO sales (user_id, party_id, date, category, qty_kg, rate) VALUES (?,?,?,?,?,?)",
                  (uid, cus[i], (today - timedelta(days=days)).isoformat(), cat, q, r))
    for m in range(1, today.month):  # earlier months, so the chart shows a rising trend
        total = 1800 + 300 * m
        for k, share in enumerate((0.6, 0.4)):
            d = date(today.year, m, 6 + k * 12).isoformat()
            cat = ("Raw Cotton", "Raw Cotton", "Processed Cotton", "Cotton Bales")[(m + k) % 4]
            qty = round(total * share)
            c.execute("INSERT INTO purchases (user_id, party_id, date, category, qty_kg, rate) VALUES (?,?,?,?,?,?)",
                      (uid, sup[(m + k) % 5], d, cat, qty, 58 + (m + k) % 5))
            c.execute("INSERT INTO sales (user_id, party_id, date, category, qty_kg, rate) VALUES (?,?,?,?,?,?)",
                      (uid, cus[(m + 2 * k) % 5], d, cat, round(qty * 0.9), 68 + (m + k) % 5))
    c.commit()


@app.post("/api/demo")
@login_required
def demo():
    if any(one(f"SELECT COUNT(*) FROM {t} WHERE user_id=?", g.uid) for t in ("suppliers", "customers", "purchases", "sales")):
        return jsonify(ok=False, error="Sample data can only be added to an empty account."), 409
    seed(db(), g.uid)
    return jsonify(ok=True)


# ---------- demo admin account (opens straight on the dashboard) ----------
AUTO_LOGIN = os.environ.get("AUTO_LOGIN", "1") == "1"   # set AUTO_LOGIN=0 to always show the sign-in page
DEMO_MOBILE, DEMO_PASSWORD = "9999999999", "Admin@123"


def ensure_demo_user():
    with sqlite3.connect(DB_PATH) as c:
        row = c.execute("SELECT id FROM users WHERE mobile=?", (DEMO_MOBILE,)).fetchone()
        if row:
            return row[0]
        cur = c.execute(
            """INSERT INTO users (full_name, business_name, mobile, email, city, state, password_hash)
               VALUES ('Admin', 'CottonConnect Demo', ?, 'admin@cottonconnect.com', 'Mumbai', 'Maharashtra', ?)""",
            (DEMO_MOBILE, generate_password_hash(DEMO_PASSWORD, method=HASH)))
        seed(c, cur.lastrowid)
        return cur.lastrowid


if AUTO_LOGIN:
    ensure_demo_user()


if __name__ == "__main__":
    app.run(debug=True)
