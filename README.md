# BookWorm

BookWorm is a full-stack Library Book Borrowing & Reservation web application for librarians and library members.

## Tech Stack

- Frontend: React + Tailwind CSS
- Backend: Node.js + Express
- Database: SQLite for local development, persisted with `sql.js`
- Authentication: JWT with role-based access control

## Features

### Admin / Librarian

- Login to an admin-only dashboard.
- View summary stats: borrowed books, overdue count, visitors, and new members.
- View borrowing activity chart, overdue loans, and quick review panel.
- Add, edit, delete, search, and filter books.
- Add and delete members with confirmation dialog.
- Manage loan transactions:
  - Check-Out
  - Check-In
  - Renew
  - Cancel reservation
- Configure daily fine rate.

### Member / Customer

- Register a new member account.
- Login to a member dashboard.
- Browse and search books by title, author, or ISBN.
- Reserve available books.
- View personal borrowing history, due dates, fine status, and payment receipts.
- Pay unpaid fines.

## Demo Accounts

| Role | Username | Password |
| --- | --- | --- |
| Admin | `admin` | `admin123` |
| Member | `student` | `student123` |

## Requirements

- Node.js 20 or newer
- npm

This project was tested with Node.js `v24.11.0`.

## Installation

From the project root:

```bash
npm install
```

## Run The App

```bash
npm run dev
```

The app will build the React frontend and start the Express server.

Open:

```text
http://127.0.0.1:4000
```

The same server serves both:

- Frontend UI
- REST API under `/api`

## Useful Commands

```bash
npm run build
```

Builds the React frontend into `client/dist`.

```bash
npm start
```

Builds the frontend and starts the backend without watch mode.

## Database

The local SQLite database is saved at:

```text
server/data/bookworm.sqlite
```

Seed data is created automatically the first time the backend starts.

## API Overview

Main API groups:

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/me`
- `GET /api/books`
- `POST /api/books`
- `PUT /api/books/:id`
- `DELETE /api/books/:id`
- `GET /api/members`
- `POST /api/members`
- `DELETE /api/members/:id`
- `GET /api/loans`
- `POST /api/reservations`
- `PATCH /api/loans/:id/action`
- `POST /api/penalties/:id/pay`
- `GET /api/dashboard`
- `GET /api/settings`
- `PUT /api/settings`

## Data Rules

- Book status: `Available`, `Borrowed`, or `Reserved`.
- A member can only reserve books with `Available` status.
- Members with unpaid fines cannot create new reservations.
- Fine amount is calculated as:

```text
overdue days x daily fine rate
```

- Date display uses `DD-MM-YYYY` in WIB / UTC+7 context.

## Troubleshooting

### Port 4000 Already In Use

If you see:

```text
Error: listen EADDRINUSE: address already in use :::4000
```

Another BookWorm server is already running.

On Windows PowerShell:

```powershell
netstat -ano | findstr :4000
Stop-Process -Id <PID>
```

Replace `<PID>` with the process id shown by `netstat`.

Alternatively, run the server on another port:

```powershell
$env:PORT=4001
npm run dev
```

Then open:

```text
http://127.0.0.1:4001
```

### npm.ps1 Cannot Be Loaded

If PowerShell blocks `npm`, use:

```powershell
npm.cmd install
npm.cmd run dev
```

## Project Structure

```text
.
├── client
│   ├── src
│   │   ├── App.jsx
│   │   ├── components
│   │   ├── lib
│   │   └── styles.css
│   └── package.json
├── server
│   ├── src
│   │   ├── database.js
│   │   ├── index.js
│   │   └── utils.js
│   ├── data
│   └── package.json
├── package.json
└── README.md
```
