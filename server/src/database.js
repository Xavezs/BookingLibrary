import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';
import { DEFAULT_DAILY_FINE_RATE, formatWibDate } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const dataDir = isServerless ? path.join(os.tmpdir(), 'bookworm-data') : path.resolve(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'bookworm.sqlite');
let SQL;
let db;
let activeTransaction = false;
const DEMO_SEED_VERSION = 'bookworm-demo-v3';

function persist() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}

function valuesFromParams(params) {
  if (!params) return [];
  const values = Array.isArray(params) ? params : Object.values(params);
  return values.map((value) => (value === undefined ? null : value));
}

export async function initDatabase() {
  SQL = await initSqlJs({
    locateFile: (file) => path.resolve(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
  });

  if (fs.existsSync(dbFile)) {
    db = new SQL.Database(fs.readFileSync(dbFile));
  } else {
    db = new SQL.Database();
  }

  runRaw('PRAGMA foreign_keys = ON;');
  runRaw(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      admin_id TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      member_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('Student', 'Faculty')),
      account_status TEXT NOT NULL DEFAULT 'Active',
      account_balance INTEGER NOT NULL DEFAULT 0,
      late_fee_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      publisher TEXT NOT NULL,
      barcode TEXT NOT NULL UNIQUE,
      isbn TEXT NOT NULL UNIQUE,
      genre TEXT NOT NULL,
      publication_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Available', 'Borrowed', 'Reserved')) DEFAULT 'Available',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('Reservation', 'Borrow', 'Return', 'Renewal')),
      status TEXT NOT NULL CHECK(status IN ('Reserved', 'Borrowed', 'Returned', 'Cancelled')) DEFAULT 'Reserved',
      borrow_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      return_date TEXT,
      receipt_number TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS penalties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      fine_amount INTEGER NOT NULL,
      late_duration INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Unpaid', 'Paid')) DEFAULT 'Unpaid',
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1
    );
  `);

  migrateDatabase();
  ensureDemoDataset();
  repairDemoLinks();
  cleanupOrphanMemberUsers();
  persist();
}

function runRaw(sql) {
  db.run(sql);
}

function hasColumn(table, column) {
  return all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

function migrateDatabase() {
  if (!hasColumn('members', 'account_balance')) {
    runRaw('ALTER TABLE members ADD COLUMN account_balance INTEGER NOT NULL DEFAULT 0');
  }
}

export function run(sql, params = []) {
  db.run(sql, valuesFromParams(params));
  if (!activeTransaction) persist();
}

export function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(valuesFromParams(params));
  try {
    if (!stmt.step()) return null;
    return stmt.getAsObject();
  } finally {
    stmt.free();
  }
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(valuesFromParams(params));
  const rows = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

export function insert(sql, params = []) {
  run(sql, params);
  const table = sql.match(/INSERT\s+INTO\s+([a-z_]+)/i)?.[1];
  if (!table) return get('SELECT last_insert_rowid() AS id').id;
  return get('SELECT seq AS id FROM sqlite_sequence WHERE name = ?', [table])?.id || get('SELECT last_insert_rowid() AS id').id;
}

export function transaction(callback) {
  try {
    db.run('BEGIN IMMEDIATE TRANSACTION');
    activeTransaction = true;
    const result = callback();
    db.run('COMMIT');
    activeTransaction = false;
    persist();
    return result;
  } catch (error) {
    try {
      db.run('ROLLBACK');
    } catch (_) {}
    activeTransaction = false;
    throw error;
  }
}

function ensureDemoDataset() {
  const version = get("SELECT value FROM settings WHERE key = 'demoSeedVersion'")?.value;
  const existing = get('SELECT COUNT(*) AS count FROM users');
  if (existing.count > 0 && version === DEMO_SEED_VERSION) return;

  resetDemoDataset();
}

function resetDemoDataset() {
  const today = formatWibDate();
  const passwordHash = bcrypt.hashSync('123123', 10);

  runRaw('PRAGMA foreign_keys = OFF;');
  for (const table of ['penalties', 'transactions', 'books', 'members', 'admins', 'users', 'settings', 'visits']) {
    runRaw(`DELETE FROM ${table};`);
  }
  runRaw("DELETE FROM sqlite_sequence WHERE name IN ('penalties','transactions','books','members','admins','users','visits');");
  runRaw('PRAGMA foreign_keys = ON;');

  const adminUserId = insert(
    'INSERT INTO users (username, password_hash, name, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['admin', passwordHash, 'BookWorm Librarian', 'admin@bookworm.local', 'admin', today]
  );
  insert('INSERT INTO admins (user_id, admin_id) VALUES (?, ?)', [adminUserId, 'ADM-0001']);

  const memberUserId = insert(
    'INSERT INTO users (username, password_hash, name, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['vinlee', passwordHash, 'Vinlee', 'vincentlee2555@gmail.com', 'member', today]
  );
  insert(
    'INSERT INTO members (user_id, full_name, email, member_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [memberUserId, 'Vinlee', 'vincentlee2555@gmail.com', '2802424972', 'Student', today]
  );

  const books = [
    ['Clean Architecture', 'Robert C. Martin', 'Prentice Hall', '100000000001', '978-0-13-449416-6', 'Software Engineering', 'September 2017', 'Available'],
    ['Database System Concepts', 'Abraham Silberschatz', 'McGraw Hill', '100000000002', '978-0-07-802215-9', 'Database', 'March 2019', 'Available'],
    ['Designing Data-Intensive Applications', 'Martin Kleppmann', 'OReilly Media', '100000000003', '978-1-449-37332-0', 'Distributed Systems', 'March 2017', 'Available'],
    ['Human-Computer Interaction', 'Alan Dix', 'Pearson', '100000000004', '978-0-13-046109-4', 'HCI', 'June 2003', 'Available'],
    ['Refactoring', 'Martin Fowler', 'Addison-Wesley', '100000000005', '978-0-13-475759-9', 'Software Engineering', 'November 2018', 'Available'],
    ['Introduction to Algorithms', 'Thomas H. Cormen', 'MIT Press', '100000000006', '978-0-26-203384-8', 'Algorithms', 'July 2009', 'Available'],
    ['Computer Networking: A Top-Down Approach', 'James F. Kurose', 'Pearson', '100000000007', '978-0-13-359414-0', 'Computer Networks', 'March 2016', 'Available'],
    ['Artificial Intelligence: A Modern Approach', 'Stuart Russell', 'Pearson', '100000000008', '978-0-13-461099-3', 'Artificial Intelligence', 'April 2020', 'Available'],
    ['Operating System Concepts', 'Abraham Silberschatz', 'Wiley', '100000000009', '978-1-11-980036-1', 'Operating Systems', 'February 2021', 'Available'],
    ['Software Engineering', 'Ian Sommerville', 'Pearson', '100000000010', '978-0-13-394303-0', 'Software Engineering', 'April 2015', 'Available']
  ];

  for (const book of books) {
    insert(
      'INSERT INTO books (title, author, publisher, barcode, isbn, genre, publication_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [...book, today, today]
    );
  }

  run('INSERT INTO settings (key, value) VALUES (?, ?)', ['dailyFineRate', String(DEFAULT_DAILY_FINE_RATE)]);
  run('INSERT INTO settings (key, value) VALUES (?, ?)', ['demoSeedVersion', DEMO_SEED_VERSION]);
  run('INSERT INTO visits (date, count) VALUES (?, ?)', [today, 42]);
}

function repairDemoLinks() {
  const vinleeUser = get("SELECT id FROM users WHERE username = 'vinlee'");
  const vinleeMember = get("SELECT id FROM members WHERE email = 'vincentlee2555@gmail.com'");
  if (vinleeUser && vinleeMember) {
    run('UPDATE members SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = 0)', [vinleeUser.id, vinleeMember.id]);
    refreshSeedBalance(vinleeMember.id);
  }

  const adminUser = get("SELECT id FROM users WHERE username = 'admin'");
  const adminRow = get('SELECT id FROM admins WHERE admin_id = ?', ['ADM-0001']);
  if (adminUser && adminRow) {
    run('UPDATE admins SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = 0)', [adminUser.id, adminRow.id]);
  }
}

function refreshSeedBalance(memberId) {
  const row = get("SELECT COALESCE(SUM(fine_amount), 0) AS balance FROM penalties WHERE member_id = ? AND status = 'Unpaid'", [memberId]);
  run('UPDATE members SET late_fee_balance = ? WHERE id = ?', [row.balance || 0, memberId]);
}

function cleanupOrphanMemberUsers() {
  run(`
    DELETE FROM users
    WHERE role = 'member'
      AND id NOT IN (
        SELECT user_id FROM members WHERE user_id IS NOT NULL
      )
  `);
}
