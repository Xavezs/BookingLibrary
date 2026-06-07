import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, BadgeCheck, BarChart3, BookOpen, CalendarClock, Check, CreditCard,
  Filter, Library, Loader2, LogOut, Plus, RefreshCw, Search, Trash2, UserPlus, Users
} from 'lucide-react';
import Modal from './components/Modal.jsx';
import { api, currency } from './lib/api.js';

const emptyBook = {
  title: '', author: '', publisher: '', barcode: '', isbn: '', genre: '',
  publication_date: '', status: 'Available'
};
const emptyMember = { full_name: '', email: '', member_code: '', status: 'Student', username: '', password: '' };
const friendlyErrors = {
  'cannot rollback': 'Action failed - please refresh and try again'
};

function StatusBadge({ status }) {
  const colors = {
    Available: 'bg-emerald-100 text-emerald-700',
    Borrowed: 'bg-red-100 text-red-700',
    Reserved: 'bg-amber-100 text-amber-700',
    Paid: 'bg-emerald-100 text-emerald-700',
    Unpaid: 'bg-red-100 text-red-700',
    None: 'bg-slate-100 text-slate-400',
    Returned: 'bg-slate-100 text-slate-700'
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[status] || 'bg-slate-100 text-slate-700'}`}>{status}</span>;
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-ink">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toast({ toast, clear }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(clear, 3500);
    return () => clearTimeout(timer);
  }, [toast, clear]);
  if (!toast) return null;
  return (
    <div className={`fixed right-5 top-5 z-[60] rounded-lg px-4 py-3 text-sm font-medium shadow-xl ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-ink text-white'}`}>
      {toast.message}
    </div>
  );
}

function Login({ onLogin, toast }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: 'admin', password: 'admin123', full_name: '', email: '', member_code: '', status: 'Student' });
  const submit = async (event) => {
    event.preventDefault();
    try {
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', body: JSON.stringify(form) });
        toast('Registration successful. You can log in now.');
        setMode('login');
        setForm((current) => ({ ...current, password: '', full_name: '', email: '', member_code: '' }));
        return;
      }
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: form.username, password: form.password }) });
      localStorage.setItem('bookworm_token', data.token);
      onLogin(data.user);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <main className="grid min-h-screen bg-slate-100 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="flex flex-col justify-between bg-navy p-10 text-white">
        <div className="flex items-center gap-3 text-xl font-bold"><Library /> BookWorm</div>
        <div className="max-w-xl py-14">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-violet-200">Library operations</p>
          <h1 className="text-5xl font-bold leading-tight">Borrow, reserve, return, and reconcile fines in one calm desk.</h1>
          <p className="mt-6 text-lg text-blue-100">Role-based dashboards for librarians and members, backed by JWT auth and local SQLite persistence.</p>
        </div>
        <p className="text-sm text-blue-100">Demo admin: admin / admin123 · Demo member: student / student123</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-md rounded-lg bg-white p-7 shadow-xl">
          <h2 className="text-2xl font-bold text-ink">{mode === 'login' ? 'Sign in' : 'Member registration'}</h2>
          <p className="mt-1 text-sm text-slate-500">{mode === 'login' ? 'You will be routed to your role dashboard.' : 'Create a member account with a unique email and ID.'}</p>
          <div className="mt-6 space-y-4">
            <Field label="Username"><input className="field" placeholder="Enter your username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="Password"><input className="field" placeholder="Enter your password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            {mode === 'register' && (
              <>
                <Field label="Full Name"><input className="field" placeholder="Example: Alya Prameswari" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
                <Field label="Email"><input className="field" placeholder="Example: alya@student.ac.id" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                <Field label="Member ID"><input className="field" placeholder="10 characters, starts with 2" value={form.member_code} onChange={(e) => setForm({ ...form, member_code: e.target.value })} /></Field>
                <Field label="Status"><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option>Student</option>
                  <option>Faculty</option>
                </select></Field>
              </>
            )}
          </div>
          <button className="primary-button mt-6 w-full">{mode === 'login' ? 'Login' : 'Register'}</button>
          <button type="button" className="mt-4 w-full text-sm font-semibold text-accent" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Create a member account' : 'Back to login'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Shell({ user, onLogout, children, active, setActive, search, setSearch }) {
  const links = user.role === 'admin'
    ? [['Dashboard', BarChart3], ['Library Loan', CalendarClock], ['Books/Cataloging', BookOpen], ['Members', Users]]
    : [['Dashboard', BarChart3], ['Library Loan', CalendarClock], ['Books/Cataloging', BookOpen]];

  return (
    <div className="min-h-screen bg-slate-100 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="bg-navy p-5 text-white lg:min-h-screen">
        <div className="mb-8 flex items-center gap-3 text-xl font-bold"><Library /> BookWorm</div>
        <nav className="grid gap-2">
          {links.map(([label, Icon]) => (
            <button key={label} onClick={() => setActive(label)} className={`sidebar-link ${active === label ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10'}`}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <p className="text-sm text-slate-500">{user.role === 'admin' ? 'Librarian dashboard' : 'Member dashboard'}</p>
            <h1 className="text-2xl font-bold text-ink">{active}</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden min-w-[320px] items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 md:flex">
              <Search size={17} className="text-slate-400" />
              <input
                className="w-full bg-transparent text-sm text-ink outline-none"
                placeholder={`Search ${active}`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button className="icon-button" title="Filter"><Filter size={18} /></button>
            <button className="secondary-button" onClick={onLogout}><LogOut size={17} /> Logout</button>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}

function Dashboard({ user, data, reload, settings, saveRate, books, setActive, search, profile, onTopUp }) {
  const [range, setRange] = useState('weekly');
  if (user.role !== 'admin') {
    const keyword = (search || '').trim().toLowerCase();
    const availableBooks = books
      .filter((book) => book.status === 'Available')
      .filter((book) => !keyword || `${book.title} ${book.author} ${book.isbn}`.toLowerCase().includes(keyword))
      .slice(0, 6);
    return (
      <section className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="panel lg:col-span-2">
            <h2 className="section-title">Welcome back, {user.name}</h2>
            <p className="mt-2 text-slate-600">Browse available books, reserve titles, and pay fines before creating new reservations.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm text-slate-500">Wallet Balance</p>
                <p className="mt-1 text-2xl font-bold text-ink">{currency(profile?.account_balance || 0)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm text-slate-500">Unpaid Fine</p>
                <p className="mt-1 text-2xl font-bold text-ink">{currency(profile?.late_fee_balance || 0)}</p>
              </div>
            </div>
          </div>
          <div className="panel">
            <h3 className="section-title">Need a book?</h3>
            <p className="mt-2 text-sm text-slate-500">Open Books/Cataloging and reserve anything marked Available.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="primary-button" onClick={() => setActive('Books/Cataloging')}>Browse Catalog</button>
              <button className="secondary-button" onClick={() => onTopUp(50000)}><CreditCard size={16} /> Top Up</button>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="section-title">Available Books</h2>
            <button className="secondary-button" onClick={() => setActive('Books/Cataloging')}>View All</button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {availableBooks.length ? availableBooks.map((book) => (
              <div key={book.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold text-ink">{book.title}</p><p className="text-sm text-slate-500">{book.author}</p></div>
                  <StatusBadge status={book.status} />
                </div>
                <p className="mt-3 text-xs text-slate-400">{book.isbn}</p>
              </div>
            )) : <p className="text-sm text-slate-500">No books are available right now.</p>}
          </div>
        </div>
      </section>
    );
  }
  const chart = data?.chart?.[range] || [];
  const max = Math.max(...chart.map((item) => item.count), 1);
  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Borrowed', data?.stats?.borrowed || 0, BookOpen],
          ['Overdue', data?.stats?.overdue || 0, AlertCircle],
          ['Visitors', data?.stats?.visitors || 0, Users],
          ['New Members', data?.stats?.newMembers || 0, UserPlus]
        ].map(([label, value, Icon]) => (
          <div className="panel" key={label}>
            <div className="flex items-center justify-between"><p className="text-sm text-slate-500">{label}</p><Icon className="text-accent" size={20} /></div>
            <p className="mt-3 text-3xl font-bold text-ink">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="panel">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="section-title">Borrowing Activity</h2>
            <div className="segmented">
              {['weekly', 'monthly'].map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}
            </div>
          </div>
          <div className="flex h-64 items-end gap-3">
            {chart.map((item) => (
              <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
                <div className="w-full rounded-t bg-accent" style={{ height: `${Math.max(10, (item.count / max) * 210)}px` }} />
                <span className="text-xs text-slate-500">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h2 className="section-title">Quick Review</h2>
          <div className="mt-4 space-y-3">
            {data?.quickReview?.map((book) => (
              <div key={book.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div><p className="font-semibold text-ink">{book.title}</p><p className="text-xs text-slate-500">{book.author}</p></div>
                <StatusBadge status={book.status} />
              </div>
            ))}
          </div>
          <label className="mt-5 block text-sm font-semibold text-ink">Daily fine rate</label>
          <div className="mt-2 flex gap-2">
            <input className="field" type="number" value={settings.dailyFineRate} onChange={(e) => saveRate(Number(e.target.value), false)} />
            <button className="primary-button" onClick={() => saveRate(settings.dailyFineRate, true)}><Check size={17} /></button>
          </div>
        </div>
      </div>
      <OverdueTable loans={data?.overdueLoans || []} reload={reload} />
    </section>
  );
}

function OverdueTable({ loans }) {
  return (
    <div className="panel">
      <h2 className="section-title">Overdue Loans</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Book</th><th>Member</th><th>Due Date</th><th>Late</th><th>Fine</th></tr></thead>
          <tbody>{loans.map((loan) => <tr key={loan.id}><td>{loan.title}</td><td>{loan.full_name}</td><td>{loan.due_date}</td><td>{loan.late_duration} days</td><td>{currency(loan.fine_amount)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Books({ user, books, setBooks, toast, reloadBooks, search }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('All');
  const [modal, setModal] = useState(null);
  const filtered = useMemo(() => books.filter((book) => {
    const keyword = (q || search || '').trim().toLowerCase();
    const text = `${book.title} ${book.author} ${book.isbn}`.toLowerCase();
    return text.includes(keyword) && (status === 'All' || book.status === status);
  }), [books, q, search, status]);

  const saveBook = async (event) => {
    event.preventDefault();
    try {
      const method = modal.id ? 'PUT' : 'POST';
      const path = modal.id ? `/books/${modal.id}` : '/books';
      await api(path, { method, body: JSON.stringify(modal) });
      toast('Book saved');
      setModal(null);
      reloadBooks();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const reserve = async (book) => {
    try {
      const data = await api('/reservations', { method: 'POST', body: JSON.stringify({ book_id: book.id }) });
      toast('Reservation confirmed');
      setModal({ type: 'receipt', details: data.details });
      reloadBooks();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <section className="space-y-5">
      <div className="toolbar">
        <div className="searchbox"><Search size={18} /><input placeholder="Search title, author, or ISBN" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="field max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>All</option><option>Available</option><option>Borrowed</option><option>Reserved</option>
        </select>
        {user.role === 'admin' && <button className="primary-button" onClick={() => setModal({ ...emptyBook })}><Plus size={17} /> Add Book</button>}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((book) => (
          <article className="panel" key={book.id}>
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-lg font-bold text-ink">{book.title}</h3><p className="text-sm text-slate-500">{book.author}</p></div>
              <StatusBadge status={book.status} />
            </div>
            <dl className="mt-4 grid gap-2 text-sm text-slate-600">
              <div><b>ISBN:</b> {book.isbn}</div><div><b>Barcode:</b> {book.barcode}</div><div><b>Subject:</b> {book.genre}</div><div><b>Published:</b> {book.publication_date}</div>
            </dl>
            <div className="mt-5 flex gap-2">
              {user.role === 'admin' ? (
                <>
                  <button className="secondary-button" onClick={() => setModal(book)}>Edit</button>
                  <button className="danger-button" onClick={async () => { await api(`/books/${book.id}`, { method: 'DELETE' }); toast('Book deleted'); reloadBooks(); }}><Trash2 size={16} /></button>
                </>
              ) : (
                <button className="primary-button" disabled={book.status !== 'Available'} onClick={() => setModal({ type: 'confirmReservation', book })}>
                  <BadgeCheck size={17} /> Reserve
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {modal && modal.type !== 'confirmReservation' && modal.type !== 'receipt' && (
        <Modal title={modal.id ? 'Edit Book' : 'Add Book'} onClose={() => setModal(null)}>
          <form onSubmit={saveBook} className="grid gap-3">
            {[
              ['title', 'Title', 'Example: Clean Architecture'],
              ['author', 'Author', 'Example: Robert C. Martin'],
              ['publisher', 'Publisher', 'Example: Prentice Hall'],
              ['barcode', 'Barcode', 'Numeric barcode'],
              ['isbn', 'ISBN', 'Example: 978-0-13-449416-6'],
              ['genre', 'Subject / Category', 'Example: Software Engineering'],
              ['publication_date', 'Publication Date', 'Example: September 2018']
            ].map(([field, label, placeholder]) => (
              <Field key={field} label={label}>
                <input className="field" placeholder={placeholder} value={modal[field]} onChange={(e) => setModal({ ...modal, [field]: e.target.value })} />
              </Field>
            ))}
            <Field label="Availability Status"><select className="field" value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value })}><option>Available</option><option>Borrowed</option><option>Reserved</option></select></Field>
            <button className="primary-button justify-center">Save Book</button>
          </form>
        </Modal>
      )}
      {modal?.type === 'confirmReservation' && (
        <Modal title="Confirm Reservation" onClose={() => setModal(null)}>
          <p className="text-slate-600">Reserve <b>{modal.book.title}</b> by {modal.book.author}?</p>
          <div className="mt-5 flex justify-end gap-2"><button className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" onClick={() => reserve(modal.book)}>Confirm</button></div>
        </Modal>
      )}
      {modal?.type === 'receipt' && (
        <Modal title="Reservation Receipt" onClose={() => setModal(null)}>
          <Receipt details={modal.details} />
        </Modal>
      )}
    </section>
  );
}

function Members({ members, toast, reloadMembers, search }) {
  const [modal, setModal] = useState(null);
  const filteredMembers = useMemo(() => {
    const keyword = (search || '').trim().toLowerCase();
    if (!keyword) return members;
    return members.filter((member) => `${member.full_name} ${member.username || ''} ${member.email} ${member.member_code}`.toLowerCase().includes(keyword));
  }, [members, search]);
  const saveMember = async (event) => {
    event.preventDefault();
    try {
      await api('/members', { method: 'POST', body: JSON.stringify(modal) });
      toast('Member added');
      setModal(null);
      reloadMembers();
    } catch (error) {
      toast(error.message, 'error');
    }
  };
  return (
    <section className="panel">
      <div className="mb-4 flex items-center justify-between"><h2 className="section-title">Members</h2><button className="primary-button" onClick={() => setModal(emptyMember)}><UserPlus size={17} /> Add Member</button></div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>ID</th><th>Status</th><th>Wallet</th><th>Unpaid Fine</th><th></th></tr></thead>
          <tbody>{filteredMembers.map((member) => (
            <tr key={member.id}>
              <td>{member.full_name}<br /><span className="text-xs text-slate-400">{member.username || 'No login'}</span></td><td>{member.username || '-'}</td><td>{member.email}</td><td>{member.member_code}</td><td>{member.status}</td><td>{currency(member.account_balance || 0)}</td><td>{currency(member.late_fee_balance)}</td>
              <td><button className="danger-button" onClick={() => setModal({ type: 'delete', member })}><Trash2 size={16} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {modal && !modal.type && (
        <Modal title="Add Member" onClose={() => setModal(null)}>
          <form onSubmit={saveMember} className="grid gap-3">
            <Field label="Full Name"><input className="field" placeholder="Example: Vinlee Tan" value={modal.full_name} onChange={(e) => setModal({ ...modal, full_name: e.target.value })} /></Field>
            <Field label="Username"><input className="field" placeholder="Example: vinlee123" value={modal.username} onChange={(e) => setModal({ ...modal, username: e.target.value })} /></Field>
            <Field label="Password"><input className="field" placeholder="Minimum 6 characters" type="password" value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} /></Field>
            <Field label="Email"><input className="field" placeholder="Example: vinlee@student.ac.id" value={modal.email} onChange={(e) => setModal({ ...modal, email: e.target.value })} /></Field>
            <Field label="Member ID"><input className="field" placeholder="10 characters, starts with 2" value={modal.member_code} onChange={(e) => setModal({ ...modal, member_code: e.target.value })} /></Field>
            <Field label="Status"><select className="field" value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value })}><option>Student</option><option>Faculty</option></select></Field>
            <button className="primary-button justify-center">Save Member</button>
          </form>
        </Modal>
      )}
      {modal?.type === 'delete' && (
        <Modal title="Confirm Delete" onClose={() => setModal(null)}>
          <p>Are you sure you want to delete <b>{modal.member.full_name}</b>?</p>
          <div className="mt-5 flex justify-end gap-2"><button className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="danger-button" onClick={async () => { await api(`/members/${modal.member.id}`, { method: 'DELETE' }); toast('Member deleted'); setModal(null); reloadMembers(); }}>Delete</button></div>
        </Modal>
      )}
    </section>
  );
}

function Loans({ user, loans, toast, reloadLoans, search, profile, onTopUp, reloadProfile }) {
  const [receipt, setReceipt] = useState(null);
  const [loadingActions, setLoadingActions] = useState({});
  const filteredLoans = useMemo(() => {
    const keyword = (search || '').trim().toLowerCase();
    if (!keyword) return loans;
    return loans.filter((loan) => `${loan.title} ${loan.full_name} ${loan.email} ${loan.status} ${loan.due_date}`.toLowerCase().includes(keyword));
  }, [loans, search]);
  const act = async (id, action) => {
    const key = `${id}:${action}`;
    if (loadingActions[key]) return;
    setLoadingActions((current) => ({ ...current, [key]: true }));
    try {
      await api(`/loans/${id}/action`, { method: 'PATCH', body: JSON.stringify({ action }) });
      toast('Loan updated');
      reloadLoans();
    } catch (error) {
      const friendly = Object.entries(friendlyErrors).find(([needle]) => error.message.includes(needle))?.[1];
      toast(friendly || error.message, 'error');
    } finally {
      setLoadingActions((current) => ({ ...current, [key]: false }));
    }
  };
  const pay = async (loan) => {
    return api(`/penalties/${loan.penalty_id || loan.id}/pay`, { method: 'POST' });
  };
  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">{user.role === 'admin' ? 'All Borrow/Return Transactions' : 'My Borrowing Status'}</h2>
          {user.role === 'member' && <p className="mt-1 text-sm text-slate-500">Wallet: {currency(profile?.account_balance || 0)} | Unpaid fine: {currency(profile?.late_fee_balance || 0)}</p>}
        </div>
        {user.role === 'member' && <button className="secondary-button" onClick={() => onTopUp(50000)}><CreditCard size={16} /> Top Up Rp 50.000</button>}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Book</th><th>Borrower</th><th>Status</th><th>Borrow Date</th><th>Due Date</th><th>Fine</th><th>Actions</th></tr></thead>
          <tbody>{filteredLoans.map((loan) => (
            <tr key={loan.id}>
              <td>{loan.title}</td><td>{loan.full_name}<br /><span className="text-xs text-slate-400">{loan.email}</span></td><td><StatusBadge status={loan.status} /></td><td>{loan.borrow_date}</td><td>{loan.due_date}</td>
              <td>
                {loan.fine_amount > 0 ? <>{currency(loan.fine_amount)} <StatusBadge status={loan.fine_status} /></> : <span className="text-sm text-slate-400">-</span>}
              </td>
              <td>
                {user.role === 'admin' ? (
                  <div className="flex flex-wrap gap-2">
                    {loan.status === 'Reserved' && <button className="secondary-button" disabled={loadingActions[`${loan.id}:checkout`]} onClick={() => act(loan.id, 'checkout')}>{loadingActions[`${loan.id}:checkout`] && <Loader2 size={15} className="animate-spin" />}Check-Out</button>}
                    {loan.status === 'Borrowed' && <button className="secondary-button" disabled={loadingActions[`${loan.id}:checkin`]} onClick={() => act(loan.id, 'checkin')}>{loadingActions[`${loan.id}:checkin`] && <Loader2 size={15} className="animate-spin" />}Check-In</button>}
                    {loan.status === 'Borrowed' && <button className="secondary-button" disabled={loadingActions[`${loan.id}:renew`]} onClick={() => act(loan.id, 'renew')}>{loadingActions[`${loan.id}:renew`] ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}Renew</button>}
                    {loan.status === 'Reserved' && <button className="danger-button" disabled={loadingActions[`${loan.id}:cancel`]} onClick={() => act(loan.id, 'cancel')}>{loadingActions[`${loan.id}:cancel`] && <Loader2 size={15} className="animate-spin" />}Cancel</button>}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {loan.status === 'Reserved' && <span className="text-sm text-slate-400">Waiting for librarian check-out</span>}
                    {loan.status === 'Borrowed' && <button className="secondary-button" disabled={loadingActions[`${loan.id}:return`]} onClick={() => act(loan.id, 'return')}>{loadingActions[`${loan.id}:return`] && <Loader2 size={15} className="animate-spin" />}Return Book</button>}
                    {loan.fine_status === 'Unpaid' && <button className="primary-button" onClick={async () => { try { const data = await pay(loan); toast('Fine paid'); setReceipt(data.receipt); reloadLoans(); reloadProfile(); } catch (error) { toast(error.message, 'error'); } }}><CreditCard size={16} /> Pay Fine</button>}
                    {loan.status === 'Returned' && loan.fine_status !== 'Unpaid' && <span className="text-sm text-slate-400">Completed</span>}
                  </div>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {receipt && <Modal title="Payment Receipt" onClose={() => setReceipt(null)}><Receipt details={receipt} /></Modal>}
    </section>
  );
}

function Receipt({ details }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      {Object.entries(details).map(([key, value]) => (
        <div key={key} className="flex justify-between border-b border-slate-200 py-2 last:border-0">
          <span className="font-semibold capitalize text-slate-500">{key.replaceAll('_', ' ')}</span>
          <span className="text-right text-ink">{typeof value === 'number' && key.includes('amount') ? currency(value) : String(value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [active, setActive] = useState('Dashboard');
  const [books, setBooks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loans, setLoans] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [settings, setSettings] = useState({ dailyFineRate: 2500 });
  const [profile, setProfile] = useState(null);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const notify = (message, type = 'success') => setToast({ message, type });

  const loadBooks = () => api('/books').then(setBooks).catch((error) => notify(error.message, 'error'));
  const loadLoans = () => api('/loans').then(setLoans).catch((error) => notify(error.message, 'error'));
  const loadMembers = () => user?.role === 'admin' && api('/members').then(setMembers).catch((error) => notify(error.message, 'error'));
  const loadDashboard = () => user?.role === 'admin' && api('/dashboard').then(setDashboard).catch((error) => notify(error.message, 'error'));
  const loadProfile = () => api('/me').then((data) => setProfile(data.member || null)).catch((error) => notify(error.message, 'error'));

  useEffect(() => {
    const token = localStorage.getItem('bookworm_token');
    if (token) api('/me').then((data) => { setUser(data); setProfile(data.member || null); }).catch(() => localStorage.removeItem('bookworm_token'));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadBooks();
    loadLoans();
    if (user.role === 'member') loadProfile();
    if (user.role === 'admin') {
      loadMembers();
      loadDashboard();
      api('/settings').then(setSettings).catch(() => {});
    }
  }, [user]);

  const saveRate = async (value, persist = false) => {
    setSettings({ dailyFineRate: value });
    if (!persist) return;
    try {
      const data = await api('/settings', { method: 'PUT', body: JSON.stringify({ dailyFineRate: value }) });
      setSettings(data);
      notify('Fine rate updated');
      loadDashboard();
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const topUp = async (amount = 50000) => {
    try {
      const data = await api('/wallet/topup', { method: 'POST', body: JSON.stringify({ amount }) });
      setProfile((current) => ({ ...(current || {}), account_balance: data.account_balance, late_fee_balance: data.late_fee_balance }));
      notify(`Top up successful: ${currency(data.amount)}`);
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  if (!user) return <><Login onLogin={setUser} toast={notify} /><Toast toast={toast} clear={() => setToast(null)} /></>;

  const logout = () => {
    localStorage.removeItem('bookworm_token');
    setUser(null);
    setProfile(null);
    setActive('Dashboard');
  };

  return (
    <>
      <Shell user={user} onLogout={logout} active={active} setActive={setActive} search={search} setSearch={setSearch}>
        {active === 'Dashboard' && <Dashboard user={user} data={dashboard} reload={loadDashboard} settings={settings} saveRate={saveRate} books={books} setActive={setActive} search={search} profile={profile} onTopUp={topUp} />}
        {active === 'Books/Cataloging' && <Books user={user} books={books} setBooks={setBooks} toast={notify} reloadBooks={() => { loadBooks(); loadLoans(); loadDashboard(); }} search={search} />}
        {active === 'Members' && user.role === 'admin' && <Members members={members} toast={notify} reloadMembers={() => { loadMembers(); loadDashboard(); }} search={search} />}
        {active === 'Library Loan' && <Loans user={user} loans={loans} toast={notify} reloadLoans={() => { loadLoans(); loadBooks(); loadDashboard(); }} search={search} profile={profile} onTopUp={topUp} reloadProfile={loadProfile} />}
      </Shell>
      <Toast toast={toast} clear={() => setToast(null)} />
    </>
  );
}
