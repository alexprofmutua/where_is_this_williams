# Where Is This Williams

A deployable Williams College location guessing game with profiles, one-vote-per-photo enforcement, delayed answer reveals, scoring, leaderboard, history, podium, reminders, and an admin question form.

## Run Locally

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Admin

Set an admin token before deployment:

```bash
ADMIN_TOKEN="use-a-long-private-token" npm start
```

Open:

```text
/admin.html
```

Use the same token in the admin form to add or update weekly questions.

## Williams Email Verification

Players must register with a `@williams.edu` email address and verify a six-digit code before voting. In local development, the API returns the testing code so you can verify the flow quickly. In production, set `NODE_ENV=production` so the code is not returned to the browser, then connect an email provider to send the code.

## Data

Persistent app data lives in:

```text
data/db.json
```

The recovered Spring '26 ranking sheet is stored at:

```text
assests/spring26-ranking.csv
```

On startup, the server imports that ranking sheet into the database if no imported leaders are present yet.

## Deployment Notes

This version uses a JSON file database, which is fine for a small deployed prototype on a server with persistent disk. If deploying to serverless platforms with ephemeral storage, move `data/db.json` to a real database such as Supabase, Neon Postgres, Firebase, or SQLite on persistent storage.

Browser reminders work only while the site/browser is active. True push/email reminders need a deployed notification service.
