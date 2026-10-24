# Automatic Mail Sender

A Node.js command-line tool for preparing and sending personalized job-application emails from a CSV contact list.

## Setup

1. Install Node.js.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and fill in your SMTP settings and personal profile values. Keep `.env` private.
4. Add your own `contacts.csv` and `resume.pdf` beside `index.js`. These files are intentionally excluded from Git.
5. Run `node index.js`.

Email sending is disabled by default. Review the preview, then set `SEND_EMAILS=true` in `.env` when you are ready to send. `DAILY_LIMIT` is capped at 150.

The contact CSV must contain the headers `name,email,company,role`. The SMTP account and sender address should be configured with your email provider's recommended settings.

## Private files

Do not commit `.env`, `contacts.csv`, `resume.pdf`, or `sent-log.json`. The repository ignores these files and `node_modules/`.
