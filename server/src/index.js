import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { all, get, initDatabase, insert, run, transaction } from './database.js';
import { addDaysWib, formatWibDate, normalizeEmail, overdueDays } from './utils.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'bookworm-dev-secret-change-me';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173';

app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === CLIENT_ORIGIN || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, username: user.username },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ message: 'Access denied for this role' });
      }
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ message: 'Invalid or expired token' });
    }
  };
}

function badRequest(res, message) {
  return res.status(400).json({ message });
}

function validateBook(body) {
  const isbnDigits = String(body.isbn || '').replace(/[^0-9X]/gi, '');
  if (!body.title || !body.author || !body.publisher || !body.barcode || !body.isbn || !body.genre || !body.publication_date) {
    return 'All book fields are required';
  }
  if (!/^\d{8,14}$/.test(body.barcode)) return 'Barcode must be a fixed-length numeric string';
  if (isbnDigits.length !== 13) return 'ISBN must contain 13 digits or ISBN characters';
  if (!/^[A-Za-z]+ \d{4}$/.test(body.publication_date)) return 'Publication Date must be Month Year, e.g. September 2018';
  if (body.status && !['Available', 'Borrowed', 'Reserved'].includes(body.status)) return 'Invalid availability status';
  return null;
}

function validateMember(body, includeAuth = false) {
  const email = normalizeEmail(body.email);
  if (!body.full_name || !/^[A-Za-z][A-Za-z\s.'-]*$/.test(body.full_name)) return 'Full Name must be alphabetic';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email must use a standard format';
  if (!/^2[A-Za-z0-9]{9}$/.test(String(body.member_code || ''))) return 'Member ID must be 10 alphanumeric characters and start with 2';
  if (!['Student', 'Faculty'].includes(body.status)) return 'Status must be Student or Faculty';
  if (includeAuth && (!body.username || !body.password || String(body.password).length < 6)) {
    return 'Username and a password of at least 6 characters are required';
  }
  return null;
}

function loanDetailsWhere(where, params = []) {
  return all(
    `SELECT t.*, b.title, b.author, b.isbn, b.status AS book_status, m.full_name, m.email, m.member_code,
      p.id AS penalty_id, COALESCE(p.fine_amount, 0) AS fine_amount, COALESCE(p.late_duration, 0) AS late_duration,
      COALESCE(p.status, 'None') AS fine_status
     FROM transactions t
     JOIN books b ON b.id = t.book_id
     JOIN members m ON m.id = t.member_id
     LEFT JOIN penalties p ON p.transaction_id = t.id
     ${where}
     ORDER BY t.id DESC`,
    params
  );
}

function recalculatePenalty(transactionId) {
  const fineRate = Number(get("SELECT value FROM settings WHERE key = 'dailyFineRate'")?.value || 2500);
  const loan = get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
  if (!loan || loan.status !== 'Borrowed') return null;

  const days = overdueDays(loan.due_date);
  const amount = days * fineRate;
  const existing = get('SELECT * FROM penalties WHERE transaction_id = ?', [transactionId]);

  if (days <= 0) {
    if (existing && existing.status === 'Unpaid') {
      run('DELETE FROM penalties WHERE transaction_id = ?', [transactionId]);
    }
    return null;
  }

  if (existing) {
    if (existing.status === 'Unpaid') {
      run('UPDATE penalties SET fine_amount = ?, late_duration = ? WHERE transaction_id = ?', [amount, days, transactionId]);
    }
  } else {
    insert(
      'INSERT INTO penalties (transaction_id, member_id, fine_amount, late_duration, status) VALUES (?, ?, ?, ?, ?)',
      [transactionId, loan.member_id, amount, days, 'Unpaid']
    );
  }
  return { amount, days };
}

function loanPeriodDays(memberOrStatus) {
  const status = typeof memberOrStatus === 'string' ? memberOrStatus : memberOrStatus?.status;
  return status === 'Faculty' ? 21 : 14;
}

function refreshMemberBalance(memberId) {
  const row = get("SELECT COALESCE(SUM(fine_amount), 0) AS balance FROM penalties WHERE member_id = ? AND status = 'Unpaid'", [memberId]);
  run('UPDATE members SET late_fee_balance = ? WHERE id = ?', [row.balance || 0, memberId]);
  return row.balance || 0;
}

function refreshBookStatus(bookId) {
  const active = get(
    "SELECT status FROM transactions WHERE book_id = ? AND status IN ('Borrowed','Reserved') ORDER BY CASE status WHEN 'Borrowed' THEN 0 ELSE 1 END, id DESC LIMIT 1",
    [bookId]
  );
  const status = active?.status || 'Available';
  run('UPDATE books SET status = ?, updated_at = ? WHERE id = ?', [status, formatWibDate(), bookId]);
  return status;
}

function refreshAllBookStatuses() {
  all('SELECT id FROM books').forEach((book) => refreshBookStatus(book.id));
}

app.get('/api/health', (req, res) => res.json({ ok: true, date: formatWibDate() }));

app.post('/api/auth/login', (req, res) => {
  const user = get('SELECT * FROM users WHERE username = ?', [req.body.username]);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    return res.status(401).json({ message: 'Invalid username or password' });
  }
  if (user.role === 'member' && !get('SELECT id FROM members WHERE user_id = ?', [user.id])) {
    return res.status(401).json({ message: 'This member account has been deleted' });
  }
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, username: user.username, role: user.role } });
});

app.post('/api/auth/register', (req, res) => {
  const message = validateMember(req.body, true);
  if (message) return badRequest(res, message);

  const email = normalizeEmail(req.body.email);
  if (get('SELECT id FROM users WHERE username = ?', [req.body.username])) return badRequest(res, 'Username already exists');
  if (get('SELECT id FROM members WHERE email = ? OR member_code = ?', [email, req.body.member_code])) return badRequest(res, 'Duplicate email or member ID');

  const today = formatWibDate();
  const userId = insert(
    'INSERT INTO users (username, password_hash, name, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [req.body.username, bcrypt.hashSync(req.body.password, 10), req.body.full_name, email, 'member', today]
  );
  const memberId = insert(
    'INSERT INTO members (user_id, full_name, email, member_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, req.body.full_name, email, req.body.member_code, req.body.status, today]
  );
  res.status(201).json({ message: 'Registration successful', member_id: memberId });
});

app.get('/api/me', auth(), (req, res) => {
  const member = req.user.role === 'member' ? get('SELECT * FROM members WHERE user_id = ?', [req.user.id]) : null;
  res.json({ ...req.user, member });
});

app.get('/api/books', auth(), (req, res) => {
  refreshAllBookStatuses();
  const { q = '', status = 'All' } = req.query;
  const clauses = [];
  const params = [];
  if (q) {
    clauses.push('(title LIKE ? OR author LIKE ? OR isbn LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status !== 'All') {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  res.json(all(`SELECT * FROM books ${where} ORDER BY title`, params));
});

app.post('/api/books', auth('admin'), (req, res) => {
  const message = validateBook(req.body);
  if (message) return badRequest(res, message);
  const today = formatWibDate();
  const id = insert(
    'INSERT INTO books (title, author, publisher, barcode, isbn, genre, publication_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [req.body.title, req.body.author, req.body.publisher, req.body.barcode, req.body.isbn, req.body.genre, req.body.publication_date, req.body.status || 'Available', today, today]
  );
  res.status(201).json(get('SELECT * FROM books WHERE id = ?', [id]));
});

app.put('/api/books/:id', auth('admin'), (req, res) => {
  const message = validateBook(req.body);
  if (message) return badRequest(res, message);
  run(
    'UPDATE books SET title = ?, author = ?, publisher = ?, barcode = ?, isbn = ?, genre = ?, publication_date = ?, status = ?, updated_at = ? WHERE id = ?',
    [req.body.title, req.body.author, req.body.publisher, req.body.barcode, req.body.isbn, req.body.genre, req.body.publication_date, req.body.status, formatWibDate(), req.params.id]
  );
  res.json(get('SELECT * FROM books WHERE id = ?', [req.params.id]));
});

app.delete('/api/books/:id', auth('admin'), (req, res) => {
  run('DELETE FROM books WHERE id = ?', [req.params.id]);
  res.json({ message: 'Book deleted' });
});

app.get('/api/members', auth('admin'), (req, res) => {
  res.json(all(`
    SELECT m.*, u.username
    FROM members m
    LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.full_name
  `));
});

app.post('/api/members', auth('admin'), (req, res) => {
  const message = validateMember(req.body, true);
  if (message) return badRequest(res, message);
  const email = normalizeEmail(req.body.email);
  if (get('SELECT id FROM members WHERE email = ? OR member_code = ?', [email, req.body.member_code])) return badRequest(res, 'Duplicate email or member ID');
  if (get('SELECT id FROM users WHERE username = ?', [req.body.username])) return badRequest(res, 'Username already exists');

  const today = formatWibDate();
  const member = transaction(() => {
    const userId = insert(
      'INSERT INTO users (username, password_hash, name, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [req.body.username, bcrypt.hashSync(req.body.password, 10), req.body.full_name, email, 'member', today]
    );
    const id = insert(
      'INSERT INTO members (user_id, full_name, email, member_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, req.body.full_name, email, req.body.member_code, req.body.status, today]
    );
    return get(`
      SELECT m.*, u.username
      FROM members m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.id = ?
    `, [id]);
  });
  res.status(201).json({ ...member, credentials_created: true });
});

app.delete('/api/members/:id', auth('admin'), (req, res) => {
  const member = get('SELECT user_id FROM members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ message: 'Member not found' });
  transaction(() => {
    run('DELETE FROM members WHERE id = ?', [req.params.id]);
    if (member.user_id) run('DELETE FROM users WHERE id = ?', [member.user_id]);
    refreshAllBookStatuses();
  });
  res.json({ message: 'Member deleted' });
});

app.get('/api/members/:id/history', auth('admin'), (req, res) => {
  res.json(loanDetailsWhere('WHERE t.member_id = ?', [req.params.id]));
});

app.get('/api/loans', auth(), (req, res) => {
  refreshAllBookStatuses();
  if (req.user.role === 'member') {
    const member = get('SELECT id FROM members WHERE user_id = ?', [req.user.id]);
    if (!member) return res.json([]);
    const loans = loanDetailsWhere('WHERE t.member_id = ?', [member.id]);
    loans.filter((loan) => loan.status === 'Borrowed').forEach((loan) => recalculatePenalty(loan.id));
    refreshMemberBalance(member.id);
    return res.json(loanDetailsWhere('WHERE t.member_id = ?', [member.id]));
  }
  all("SELECT id FROM transactions WHERE status = 'Borrowed'").forEach((loan) => recalculatePenalty(loan.id));
  res.json(loanDetailsWhere(''));
});

app.post('/api/reservations', auth('member'), (req, res) => {
  refreshAllBookStatuses();
  const member = get('SELECT * FROM members WHERE user_id = ?', [req.user.id]);
  if (!member) return res.status(404).json({ message: 'Member profile not found' });
  if (member.late_fee_balance > 0) return badRequest(res, 'Please pay unpaid fines before making a new reservation');

  const book = get('SELECT * FROM books WHERE id = ?', [req.body.book_id]);
  if (!book || book.status !== 'Available') return badRequest(res, 'Sorry, this book is currently unavailable');
  const duplicate = get(
    "SELECT id FROM transactions WHERE book_id = ? AND member_id = ? AND status IN ('Reserved','Borrowed')",
    [book.id, member.id]
  );
  if (duplicate) return badRequest(res, 'You already have an active transaction for this book');

  const today = formatWibDate();
  const receipt = `BW-${Date.now()}`;
  const dueDate = addDaysWib(loanPeriodDays(member));
  const reservation = transaction(() => {
    run("UPDATE books SET status = 'Reserved', updated_at = ? WHERE id = ?", [today, book.id]);
    const id = insert(
      'INSERT INTO transactions (book_id, member_id, type, status, borrow_date, due_date, receipt_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [book.id, member.id, 'Reservation', 'Reserved', today, dueDate, receipt, today]
    );
    return get('SELECT * FROM transactions WHERE id = ?', [id]);
  });

  res.status(201).json({
    message: 'Reservation confirmed',
    details: {
      receipt_number: reservation.receipt_number,
      book_title: book.title,
      author: book.author,
      status: reservation.status,
      borrower_email: member.email,
      borrower_number: member.member_code,
      borrow_date: reservation.borrow_date,
      due_date: reservation.due_date
    }
  });
});

app.patch('/api/loans/:id/action', auth(), (req, res) => {
  const loan = get('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
  if (!loan) return res.status(404).json({ message: 'Transaction not found' });
  const today = formatWibDate();

  transaction(() => {
    if (req.user.role === 'member') {
      const member = get('SELECT id FROM members WHERE user_id = ?', [req.user.id]);
      if (!member || member.id !== loan.member_id) throw new Error('Cannot update another member loan');
      if (req.body.action !== 'return') throw new Error('Members can only return borrowed books');
      if (!['Borrowed'].includes(loan.status)) throw new Error('Only Borrowed loans can be returned');
      recalculatePenalty(loan.id);
      run("UPDATE transactions SET type = 'Return', status = 'Returned', return_date = ? WHERE id = ?", [today, loan.id]);
      run("UPDATE books SET status = 'Available', updated_at = ? WHERE id = ?", [today, loan.book_id]);
    } else if (req.body.action === 'checkout') {
      if (!['Reserved'].includes(loan.status)) throw new Error('Only Reserved loans can be checked out');
      const borrower = get('SELECT status FROM members WHERE id = ?', [loan.member_id]);
      run("UPDATE transactions SET type = 'Borrow', status = 'Borrowed', borrow_date = ?, due_date = ? WHERE id = ?", [today, addDaysWib(loanPeriodDays(borrower)), loan.id]);
      run("UPDATE books SET status = 'Borrowed', updated_at = ? WHERE id = ?", [today, loan.book_id]);
    } else if (req.body.action === 'checkin') {
      if (!['Borrowed'].includes(loan.status)) throw new Error('Only Borrowed loans can be checked in');
      recalculatePenalty(loan.id);
      run("UPDATE transactions SET type = 'Return', status = 'Returned', return_date = ? WHERE id = ?", [today, loan.id]);
      run("UPDATE books SET status = 'Available', updated_at = ? WHERE id = ?", [today, loan.book_id]);
    } else if (req.body.action === 'renew') {
      if (!['Borrowed'].includes(loan.status)) throw new Error('Only Borrowed loans can be renewed');
      const borrower = get('SELECT status FROM members WHERE id = ?', [loan.member_id]);
      run("UPDATE transactions SET type = 'Renewal', due_date = ? WHERE id = ?", [addDaysWib(loanPeriodDays(borrower)), loan.id]);
    } else if (req.body.action === 'simulateOverdue') {
      if (!['Borrowed'].includes(loan.status)) throw new Error('Only Borrowed loans can be marked overdue');
      run('UPDATE transactions SET due_date = ? WHERE id = ?', [addDaysWib(-7), loan.id]);
      recalculatePenalty(loan.id);
    } else if (req.body.action === 'cancel') {
      if (!['Reserved'].includes(loan.status)) throw new Error('Only Reserved loans can be cancelled');
      run("UPDATE transactions SET status = 'Cancelled' WHERE id = ?", [loan.id]);
      run("UPDATE books SET status = 'Available', updated_at = ? WHERE id = ?", [today, loan.book_id]);
    } else {
      throw new Error('Unsupported loan action');
    }
    refreshMemberBalance(loan.member_id);
    refreshBookStatus(loan.book_id);
  });

  res.json({ message: 'Loan updated', transaction: loanDetailsWhere('WHERE t.id = ?', [loan.id])[0] });
});

app.post('/api/penalties/:id/pay', auth('member'), (req, res) => {
  const penalty = get('SELECT p.*, t.receipt_number FROM penalties p JOIN transactions t ON t.id = p.transaction_id WHERE p.id = ?', [req.params.id]);
  if (!penalty) return res.status(404).json({ message: 'Fine not found' });
  if (penalty.status === 'Paid') return badRequest(res, 'This fine is already paid');
  const member = get('SELECT * FROM members WHERE user_id = ?', [req.user.id]);
  if (!member || member.id !== penalty.member_id) return res.status(403).json({ message: 'Cannot pay another member fine' });
  if (member.account_balance < penalty.fine_amount) return badRequest(res, 'Insufficient balance. Please top up first');

  const paidAt = formatWibDate();
  const result = transaction(() => {
    run("UPDATE members SET account_balance = account_balance - ? WHERE id = ?", [penalty.fine_amount, member.id]);
    run("UPDATE penalties SET status = 'Paid', paid_at = ? WHERE id = ?", [paidAt, penalty.id]);
    const unpaidBalance = refreshMemberBalance(member.id);
    const updatedMember = get('SELECT account_balance FROM members WHERE id = ?', [member.id]);
    return { unpaidBalance, walletBalance: updatedMember.account_balance };
  });
  res.json({
    message: 'Fine paid',
    receipt: {
      receipt_number: `${penalty.receipt_number}-FINE`,
      paid_at: paidAt,
      amount: penalty.fine_amount,
      late_duration: penalty.late_duration,
      member: member.full_name,
      unpaid_fine_balance: result.unpaidBalance,
      wallet_balance: result.walletBalance
    }
  });
});

app.post('/api/wallet/topup', auth('member'), (req, res) => {
  const amount = Number(req.body.amount || 50000);
  if (!Number.isFinite(amount) || amount <= 0) return badRequest(res, 'Top up amount must be positive');
  const member = get('SELECT * FROM members WHERE user_id = ?', [req.user.id]);
  if (!member) return res.status(404).json({ message: 'Member profile not found' });
  run('UPDATE members SET account_balance = account_balance + ? WHERE id = ?', [Math.round(amount), member.id]);
  const updated = get('SELECT account_balance, late_fee_balance FROM members WHERE id = ?', [member.id]);
  res.json({
    message: 'Top up successful',
    amount: Math.round(amount),
    account_balance: updated.account_balance,
    late_fee_balance: updated.late_fee_balance
  });
});

app.get('/api/dashboard', auth('admin'), (req, res) => {
  refreshAllBookStatuses();
  all("SELECT id FROM transactions WHERE status = 'Borrowed'").forEach((loan) => recalculatePenalty(loan.id));
  const today = formatWibDate();
  const borrowed = get("SELECT COUNT(*) AS count FROM transactions WHERE status = 'Borrowed'").count;
  const visitors = get('SELECT COALESCE(SUM(count), 0) AS count FROM visits').count;
  const newMembers = get('SELECT COUNT(*) AS count FROM members WHERE created_at = ?', [today]).count;
  const overdueLoans = loanDetailsWhere("WHERE t.status = 'Borrowed' AND p.status = 'Unpaid' AND p.late_duration > 0");
  const overdue = overdueLoans.length;
  const weekly = all(`
    SELECT borrow_date AS label, COUNT(*) AS count
    FROM transactions
    WHERE status IN ('Borrowed','Returned')
    GROUP BY borrow_date
    ORDER BY id DESC
    LIMIT 7
  `).reverse();
  const monthly = all(`
    SELECT substr(borrow_date, 4, 7) AS label, COUNT(*) AS count
    FROM transactions
    WHERE status IN ('Borrowed','Returned')
    GROUP BY substr(borrow_date, 4, 7)
    ORDER BY substr(borrow_date, 7, 4), substr(borrow_date, 4, 2)
  `);
  res.json({
    stats: { borrowed, overdue, visitors, newMembers },
    chart: {
      weekly,
      monthly
    },
    overdueLoans,
    quickReview: all('SELECT * FROM books ORDER BY updated_at DESC LIMIT 4')
  });
});

app.get('/api/settings', auth('admin'), (req, res) => {
  res.json({ dailyFineRate: Number(get("SELECT value FROM settings WHERE key = 'dailyFineRate'")?.value || 2500) });
});

app.put('/api/settings', auth('admin'), (req, res) => {
  const rate = Number(req.body.dailyFineRate);
  if (!Number.isFinite(rate) || rate < 0) return badRequest(res, 'Daily fine rate must be a positive number');
  run("UPDATE settings SET value = ? WHERE key = 'dailyFineRate'", [String(rate)]);
  res.json({ dailyFineRate: rate });
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Server error' });
});

await initDatabase();

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`BookWorm API running on http://127.0.0.1:${PORT}`);
  });
}

export default app;
