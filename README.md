# Where Is This Williams

A Williams College campus-location guessing app with simple player profiles, timed photo challenges, delayed answer reveals, scoring, voting history, and leaderboards.

Players sign in with a Williams email and Instagram username, then submit one guess per photo before the voting deadline. Correct answers stay hidden until the configured reveal time.

## Live App

The production app is deployed on Railway:

```text
https://whereisthiswilliams-production.up.railway.app/
```

## Screenshots

![Home page with player registration form](docs/screenshots/home.png)

![Spring 2026 leaderboard table](docs/screenshots/leaderboard.png)

![Podium of champions page](docs/screenshots/podium.png)

![About section for the app](docs/screenshots/about.png)

## Features

- Williams-only player registration with `@williams.edu` email and Instagram username.
- Player profiles with Instagram usernames, avatars, and uploaded profile pictures.
- Timed photo challenges with one saved guess per player.
- Delayed answer reveals after each configured reveal time.
- Base scoring with optional per-photo bonus points.
- Leaderboard combining imported Spring '26 rankings with live app results.
- Personal voting history with guesses, results, bonus points, and totals.
- Term podium page for first, second, and third place winners.
- Browser reminders for upcoming photos while the site is open.
- Admin form for adding or updating location challenges.

## Tech Stack

- Node.js 18+
- Native Node HTTP server
- Static HTML, CSS, and JavaScript frontend
- JSON-file persistence through `data/db.json`
- Railway-ready deployment through `npm start`

## Project Structure

```text
.
|-- index.html          # Player profile, reminders, and guessing flow
|-- leaderboard.html    # Ranked table across imported and current results
|-- history.html        # Current player's saved voting history
|-- podium.html         # Term winners gallery
|-- admin.html          # Admin form for creating/updating challenges
|-- app.js              # Browser-side app logic
|-- admin.js            # Admin form submission logic
|-- server.js           # Static file server and JSON API
|-- style.css           # App styling
|-- data/db.json        # Local JSON database
`-- assests/            # Images and imported score CSV
```

Note: the asset folder is currently named `assests`, and the app references that spelling throughout the code.

## Local Development

Install dependencies if needed, then start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Player sign-in only requires a Williams email and Instagram username.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Server port. Railway sets this automatically. Defaults to `3000`. |
| `ADMIN_TOKEN` | Yes for production | Private token required for the admin question form. Defaults to `change-me` locally. |
| `NODE_ENV` | Recommended for production | Set to `production` for production deployments. |

Example production configuration:

```bash
ADMIN_TOKEN="use-a-long-private-token"
NODE_ENV="production"
```

## Railway Deployment

This app is deployed on Railway as a Node service.

1. Create a new Railway project from the repository.
2. Set the start command to:

```bash
npm start
```

3. Add the production environment variables listed above.
4. Let Railway provide the `PORT` variable automatically.
5. Use the Railway production domain above, or connect a custom domain in Railway's service settings.

The app routes are served from the same service:

```text
/                 Player app
/leaderboard.html Leaderboard
/history.html     Player history
/podium.html      Term winners
/admin.html       Admin challenge form
```

## Admin Workflow

Start the app with an `ADMIN_TOKEN`, then open:

```text
/admin.html
```

Use the same token in the form to create or update a challenge. Each challenge needs an id, title, image path, answer options, correct answer, posted time, voting deadline, reveal time, and optional bonus points.

## Data

Persistent app data lives in:

```text
data/db.json
```

The imported Spring '26 ranking sheet lives in:

```text
assests/spring26-ranking.csv
```

On startup, the server imports that ranking sheet into `data/db.json` if imported leaders are not already present. Current player scores are merged with imported leaderboard rows by matching usernames.

## Production Notes

The current database is a JSON file. That is simple and fine for a small single-instance app, but production Railway deployments need persistent storage if you want data to survive redeploys. Use a Railway volume or move persistence to a managed database such as Postgres before relying on this for long-running live usage.

Browser reminders only work while the site is open and notification permission is granted. Push or email reminders require a separate notification service.
