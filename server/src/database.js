import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';
import { DEFAULT_DAILY_FINE_RATE, addDaysWib, formatWibDate } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'bookworm.sqlite');
let SQL;
let db;
let activeTransaction = false;

function persist() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}

function valuesFromParams(params) {
  if (!params) return [];
  return Array.isArray(params) ? params : Object.values(params);
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

  seed();
  repairDemoLinks();
  cleanupOrphanMemberUsers();
  persist();
}

function runRaw(sql) {
  db.run(sql);
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

function seed() {
  const existing = get('SELECT COUNT(*) AS count FROM users');
  if (existing.count > 0) return;

  const today = formatWibDate();
  const adminHash = bcrypt.hashSync('admin123', 10);
  const memberHash = bcrypt.hashSync('student123', 10);

  const adminUserId = insert(
    'INSERT INTO users (username, password_hash, name, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['admin', adminHash, 'Mira Librarian', 'admin@bookworm.local', 'admin', today]
  );
  insert('INSERT INTO admins (user_id, admin_id) VALUES (?, ?)', [adminUserId, 'ADM-0001']);

  const memberUserId = insert(
    'INSERT INTO users (username, password_hash, name, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['student', memberHash, 'Alya Prameswari', 'alya@student.ac.id', 'member', today]
  );
  const memberId = insert(
    'INSERT INTO members (user_id, full_name, email, member_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [memberUserId, 'Alya Prameswari', 'alya@student.ac.id', '2123456789', 'Student', today]
  );

  const books = [
    ['Clean Architecture', 'Robert C. Martin', 'Prentice Hall', '100000000001', '978-0-13-449416-6', 'Software Engineering', 'September 2017', 'Available'],
    ['Database System Concepts', 'Abraham Silberschatz', 'McGraw Hill', '100000000002', '978-0-07-802215-9', 'Database', 'March 2019', 'Available'],
    ['Designing Data-Intensive Applications', 'Martin Kleppmann', 'OReilly Media', '100000000003', '978-1-449-37332-0', 'Distributed Systems', 'March 2017', 'Borrowed'],
    ['Human-Computer Interaction', 'Alan Dix', 'Pearson', '100000000004', '978-0-13-046109-4', 'HCI', 'June 2003', 'Reserved'],
    ['Refactoring', 'Martin Fowler', 'Addison-Wesley', '100000000005', '978-0-13-475759-9', 'Software Engineering', 'November 2018', 'Available']
  ];

  for (const book of books) {
    insert(
      'INSERT INTO books (title, author, publisher, barcode, isbn, genre, publication_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [...book, today, today]
    );
  }

  const borrowed = insert(
    'INSERT INTO transactions (book_id, member_id, type, status, borrow_date, due_date, receipt_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [3, memberId, 'Borrow', 'Borrowed', '01-05-2026', '15-05-2026', 'BW-SEED-0001', today]
  );
  insert(
    'INSERT INTO penalties (transaction_id, member_id, fine_amount, late_duration, status) VALUES (?, ?, ?, ?, ?)',
    [borrowed, memberId, 10000, 4, 'Unpaid']
  );
  run('UPDATE members SET late_fee_balance = ? WHERE id = ?', [10000, memberId]);

  insert(
    'INSERT INTO transactions (book_id, member_id, type, status, borrow_date, due_date, receipt_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [4, memberId, 'Reservation', 'Reserved', today, addDaysWib(14), 'BW-SEED-0002', today]
  );

  run('INSERT INTO settings (key, value) VALUES (?, ?)', ['dailyFineRate', String(DEFAULT_DAILY_FINE_RATE)]);
  run('INSERT INTO visits (date, count) VALUES (?, ?)', [today, 42]);
}

function repairDemoLinks() {
  const studentUser = get("SELECT id FROM users WHERE username = 'student'");
  const studentMember = get("SELECT id FROM members WHERE email = 'alya@student.ac.id'");
  if (studentUser && studentMember) {
    run('UPDATE members SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = 0)', [studentUser.id, studentMember.id]);
    refreshSeedBalance(studentMember.id);
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
