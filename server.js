import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "data", "db.json");
const analyticsPath = path.join(__dirname, "data", "analytics.json");
const rankingCsvPath = path.join(__dirname, "assests", "spring26-ranking.csv");
const port = Number(process.env.PORT || 3000);
const adminToken = process.env.ADMIN_TOKEN || "change-me";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

const mimeTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

await ensureDb();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Server error" });
  }
}).listen(port, () => {
  console.log(`Where Is This Williams running at http://localhost:${port}`);
});

async function ensureDb() {
  await mkdir(path.dirname(dbPath), { recursive: true });
  if (!existsSync(dbPath)) return;

  const db = await readDb();
  const importedLeaders = await readRankingCsv();

  if (importedLeaders.length && db.importedLeaders.length === 0) {
    db.importedLeaders = importedLeaders;
    db.termWinners = [
      {
        term: db.settings.currentTerm,
        winners: importedLeaders.slice(0, 3).map((leader, index) => ({
          place: index + 1,
          screenName: leader.screenName,
          points: leader.points,
          image: `assests/photos/sample-${index + 1}.svg`,
        })),
      },
    ];
    await writeDb(db);
  }
}

async function readDb() {
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (isSupabaseConfigured()) await hydrateDbFromSupabase(db);
  return db;
}

async function writeDb(db) {
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);
  if (isSupabaseConfigured()) await syncSupabase(db);
}

async function readAnalytics() {
  if (!existsSync(analyticsPath)) return emptyAnalytics();
  return ensureAnalytics(JSON.parse(await readFile(analyticsPath, "utf8")));
}

async function writeAnalytics(analytics) {
  await writeFile(analyticsPath, `${JSON.stringify(ensureAnalytics(analytics), null, 2)}\n`);
}

function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function isSupabaseAuthConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

async function hydrateDbFromSupabase(db) {
  const [playerRows, voteRows] = await Promise.all([
    supabaseFetch("/rest/v1/witw_players?select=*"),
    supabaseFetch("/rest/v1/witw_votes?select=*"),
  ]);

  for (const row of playerRows) {
    db.players[row.unix] = row.payload || supabaseRowToPlayer(row);
  }

  const votesById = new Map(db.votes.map((vote) => [vote.id, vote]));
  for (const row of voteRows) {
    const vote = row.payload || supabaseRowToVote(row);
    votesById.set(vote.id, vote);
  }
  db.votes = [...votesById.values()];
}

async function syncSupabase(db) {
  const players = Object.values(db.players).map(playerToSupabaseRow);
  const votes = db.votes.map(voteToSupabaseRow);

  await Promise.all([
    players.length ? supabaseFetch("/rest/v1/witw_players", { method: "POST", body: players, prefer: "resolution=merge-duplicates" }) : null,
    votes.length ? supabaseFetch("/rest/v1/witw_votes", { method: "POST", body: votes, prefer: "resolution=merge-duplicates" }) : null,
  ]);
}

async function supabaseFetch(pathname, options = {}) {
  const headers = {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
  };
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetch(`${supabaseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function supabaseAuthFetch(pathname, options = {}) {
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${options.accessToken || supabaseAnonKey}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(`${supabaseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase auth request failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function playerToSupabaseRow(player) {
  return {
    unix: player.unix,
    email: player.email,
    instagram: player.instagram || player.screenName,
    screen_name: player.screenName || player.instagram,
    real_name: player.realName || "",
    avatar: player.avatar || "",
    avatar_image: player.avatarImage || null,
    referred_by: player.referredBy || null,
    verified: Boolean(player.verified),
    payload: player,
    updated_at: new Date().toISOString(),
  };
}

function voteToSupabaseRow(vote) {
  return {
    id: vote.id,
    unix: vote.unix,
    question_id: vote.questionId,
    title: vote.title,
    choice: vote.choice,
    feedback_text: vote.feedbackText || null,
    answered_at: vote.answeredAt,
    payload: vote,
  };
}

function supabaseRowToPlayer(row) {
  return {
    unix: row.unix,
    email: row.email,
    instagram: row.instagram,
    screenName: row.screen_name || row.instagram,
    realName: row.real_name || "",
    avatar: row.avatar || "💜",
    avatarImage: row.avatar_image || undefined,
    referredBy: row.referred_by || undefined,
    verified: Boolean(row.verified),
  };
}

function supabaseRowToVote(row) {
  return {
    id: row.id,
    unix: row.unix,
    questionId: row.question_id,
    title: row.title,
    choice: row.choice,
    feedbackText: row.feedback_text || undefined,
    answeredAt: row.answered_at,
  };
}

async function handleApi(req, res, url) {
  const db = await readDb();

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, {
      settings: db.settings,
      questions: db.questions.map(publicQuestion),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/send-link") {
    const body = await readJson(req);
    const email = normalizeWilliamsEmail(body.email);
    const redirectTo = normalizeRedirectUrl(body.redirectTo, req);
    if (!isSupabaseAuthConfigured()) throw httpError(500, "Supabase auth is not configured yet.");

    await supabaseAuthFetch("/auth/v1/otp", {
      method: "POST",
      body: {
        email,
        type: "magiclink",
        options: {
          email_redirect_to: redirectTo,
        },
      },
    });
    sendJson(res, 200, { sent: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/password-login") {
    const body = await readJson(req);
    const email = normalizeWilliamsEmail(body.email);
    const password = normalizePassword(body.password);
    if (!isSupabaseAuthConfigured()) throw httpError(500, "Supabase auth is not configured yet.");

    const session = await passwordLogin(email, password);
    const authUser = await verifySupabaseAccessToken(session.access_token);
    const player = upsertVerifiedPlayer(db, {
      email: authUser.email,
      referredBy: String(body.referredBy || "").trim().toLowerCase(),
    });
    await writeDb(db);
    sendJson(res, 200, { accessToken: session.access_token, player: publicPlayer(player), needsProfile: !hasDisplayProfile(player) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/password-signup") {
    const body = await readJson(req);
    const email = normalizeWilliamsEmail(body.email);
    const password = normalizePassword(body.password);
    const instagram = normalizeInstagram(body.instagram);
    const referredBy = String(body.referredBy || "").trim().toLowerCase();
    if (!instagram) throw httpError(400, "Instagram username is required for sign up.");
    if (!isSupabaseAuthConfigured()) throw httpError(500, "Supabase auth is not configured yet.");
    assertInstagramAvailable(db, unixFromEmail(email), instagram);

    const session = await passwordSignup(email, password, instagram);
    const pendingPlayer = upsertVerifiedPlayer(db, { email, referredBy });
    db.players[pendingPlayer.unix] = {
      ...pendingPlayer,
      instagram,
      screenName: instagram,
      realName: instagram,
      verified: Boolean(session?.access_token),
    };
    await writeDb(db);

    if (!session?.access_token) {
      sendJson(res, 202, {
        needsEmailConfirmation: true,
        message: "Check your Williams email once to confirm your new account. After that, log in with your password.",
      });
      return;
    }

    sendJson(res, 200, { accessToken: session.access_token, player: publicPlayer(db.players[pendingPlayer.unix]), needsProfile: false });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/session") {
    const body = await readJson(req);
    const accessToken = body.accessToken || await exchangeSupabaseCode(body.code);
    const authUser = await verifySupabaseAccessToken(accessToken);
    const player = upsertVerifiedPlayer(db, {
      email: authUser.email,
      referredBy: String(body.referredBy || "").trim().toLowerCase(),
    });
    await writeDb(db);
    sendJson(res, 200, { accessToken, player: publicPlayer(player), needsProfile: !hasDisplayProfile(player) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/profile") {
    const authUser = await authUserFromRequest(req);
    const body = await readJson(req);
    const instagram = normalizeInstagram(body.instagram);
    if (!instagram) throw httpError(400, "Instagram username is required.");
    assertInstagramAvailable(db, authUser.unix, instagram);

    const player = upsertVerifiedPlayer(db, { email: authUser.email, referredBy: String(body.referredBy || "").trim().toLowerCase() });
    db.players[player.unix] = {
      ...player,
      instagram,
      screenName: instagram,
      realName: instagram,
      verified: true,
    };
    await writeDb(db);
    sendJson(res, 200, { player: publicPlayer(db.players[player.unix]) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/players") {
    const body = await readJson(req);
    if (isSupabaseAuthConfigured()) {
      const authUser = await authUserFromRequest(req);
      const targetUnix = String(body.unix || body.email?.split("@")[0] || "").trim().toLowerCase();
      if (targetUnix && targetUnix !== authUser.unix) throw httpError(403, "You can only update your own profile.");
    }
    const player = normalizePlayer(body);
    const existingPlayer = db.players[player.unix];
    if (existingPlayer && (existingPlayer.instagram || existingPlayer.screenName) !== player.instagram) {
      throw httpError(409, "This Williams email is already registered. Enter the Instagram username exactly as it was first saved.");
    }

    db.players[player.unix] = existingPlayer
      ? {
          ...existingPlayer,
          email: player.email,
          realName: player.realName,
          screenName: player.screenName,
          instagram: player.instagram,
          avatar: player.avatar ?? existingPlayer.avatar,
          avatarImage: player.avatarImage === null ? undefined : player.avatarImage ?? existingPlayer.avatarImage,
          verified: true,
        }
      : {
          ...player,
          avatar: player.avatar || "💜",
          referredBy: player.referredBy,
          verified: true,
        };
    await writeDb(db);
    sendJson(res, 200, { player: publicPlayer(db.players[player.unix]), created: !existingPlayer });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/players/")) {
    const unix = decodeURIComponent(url.pathname.split("/").at(-1)).toLowerCase();
    sendJson(res, 200, { player: db.players[unix] ? publicPlayer(db.players[unix]) : null });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/votes") {
    const body = await readJson(req);
    await requirePlayerAuth(req, body.unix);
    const vote = createVote(db, body);
    db.votes.push(vote);
    await writeDb(db);
    sendJson(res, 201, { vote: publicVote(db, vote) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/post-submissions") {
    const body = await readJson(req);
    await requirePlayerAuth(req, body.unix);
    const votes = createPostSubmissionVotes(db, body);
    db.votes.push(...votes);
    await writeDb(db);
    sendJson(res, 201, { votes: votes.map((vote) => publicVote(db, vote)) });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/history/")) {
    const unix = decodeURIComponent(url.pathname.split("/").at(-1)).toLowerCase();
    sendJson(res, 200, {
      votes: db.votes.filter((vote) => vote.unix === unix).map((vote) => publicVote(db, vote)),
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/achievements/")) {
    const unix = decodeURIComponent(url.pathname.split("/").at(-1)).toLowerCase();
    sendJson(res, 200, { achievements: buildAchievements(db, unix), cheers: buildCheers(db, unix) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    sendJson(res, 200, { leaders: buildLeaderboard(db) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/podium") {
    sendJson(res, 200, { terms: (db.termWinners || []).filter((term) => term.finalized) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/questions") {
    requireAdmin(req);
    sendJson(res, 200, { questions: db.questions });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/export-db") {
    requireAdmin(req);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="where-is-this-williams-live-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    res.end(`${JSON.stringify(db, null, 2)}\n`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/stats") {
    requireAdmin(req);
    sendJson(res, 200, { stats: await buildAdminStats(db) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/leaderboard") {
    requireAdmin(req);
    sendJson(res, 200, { leaders: buildAdminLeaderboard(db) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/podium") {
    requireAdmin(req);
    sendJson(res, 200, {
      terms: db.termWinners || [],
      currentTop: buildAdminLeaderboard(db).filter((leader) => leader.points > 0).slice(0, 3),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/player-detail") {
    requireAdmin(req);
    const lookup = String(url.searchParams.get("player") || "").trim();
    const player = findPlayer(db, lookup);
    if (!player) throw httpError(404, "Player not found.");
    sendJson(res, 200, buildAdminPlayerDetail(db, player));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/player-achievements") {
    requireAdmin(req);
    const lookup = String(url.searchParams.get("player") || "").trim();
    const player = findPlayer(db, lookup);
    if (!player) throw httpError(404, "Player not found.");
    sendJson(res, 200, {
      player: publicPlayer(player),
      achievements: buildAchievements(db, player.unix),
      cheers: buildCheers(db, player.unix),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/questions") {
    requireAdmin(req);
    const question = normalizeQuestion(await readJson(req));
    const index = db.questions.findIndex((item) => item.id === question.id);
    if (index >= 0) db.questions[index] = question;
    else db.questions.push(question);
    await writeDb(db);
    sendJson(res, 200, { question });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(__dirname, requested));

  if (!filePath.startsWith(__dirname)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const extension = path.extname(filePath);
    const headers = { "Content-Type": mimeTypes[extension] || "application/octet-stream" };
    if ([".html", ".js", ".css"].includes(extension)) {
      headers["Cache-Control"] = "no-store";
    }
    if (extension === ".html") {
      const visit = await trackVisit(req, requested);
      if (visit.cookie) headers["Set-Cookie"] = visit.cookie;
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function trackVisit(req, page) {
  const normalizedPage = page === "/" ? "/index.html" : page;
  const analytics = await readAnalytics();
  const now = new Date().toISOString();
  let visitorId = getCookie(req, "witw_visitor");
  let cookie = null;

  if (!visitorId) {
    visitorId = randomUUID();
    cookie = `witw_visitor=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  analytics.totalVisits += 1;
  analytics.pages[normalizedPage] = (analytics.pages[normalizedPage] || 0) + 1;
  analytics.visitors[visitorId] = {
    firstSeenAt: analytics.visitors[visitorId]?.firstSeenAt || now,
    lastSeenAt: now,
    visits: (analytics.visitors[visitorId]?.visits || 0) + 1,
  };
  analytics.recentVisits.unshift({ page: normalizedPage, visitorId, at: now });
  analytics.recentVisits = analytics.recentVisits.slice(0, 100);
  await writeAnalytics(analytics);
  return { cookie };
}

function createVote(db, body) {
  const unix = String(body.unix || "").trim().toLowerCase();
  const questionId = String(body.questionId || "").trim();
  const choice = String(body.choice || "").trim();
  const feedbackText = String(body.feedbackText || "").trim().slice(0, 800);
  const question = db.questions.find((item) => item.id === questionId);

  if (!db.players[unix]) throw httpError(400, "Sign up or log in first.");
  if (!db.players[unix].verified) throw httpError(403, "Verify your Williams email before voting.");
  if (!question) throw httpError(404, "Question not found.");
  if (!isPosted(question)) throw httpError(400, "Voting has not opened for this photo yet.");
  if (isDeadlineOver(question)) throw httpError(400, "Voting is closed for this photo.");
  if (!question.options.includes(choice)) throw httpError(400, "Invalid choice.");
  if (db.votes.some((vote) => vote.unix === unix && vote.questionId === questionId)) {
    throw httpError(409, "This player already voted for this photo.");
  }

  return {
    id: `${questionId}-${unix}`,
    unix,
    questionId,
    title: question.title,
    choice,
    feedbackText: question.kind === "feedback" ? feedbackText : undefined,
    answeredAt: new Date().toISOString(),
  };
}

function createPostSubmissionVotes(db, body) {
  const unix = String(body.unix || "").trim().toLowerCase();
  const selections = Array.isArray(body.selections) ? body.selections : [];

  if (!db.players[unix]) throw httpError(400, "Sign up or log in first.");
  if (!db.players[unix].verified) throw httpError(403, "Verify your Williams email before voting.");
  if (!selections.length) throw httpError(400, "Choose at least one answer before submitting.");

  return selections.map((selection) => {
    const questionId = String(selection.postId || selection.questionId || "").trim();
    const question = db.questions.find((item) => item.id === questionId);
    const isFeedback = question?.kind === "feedback";
    const choice = isFeedback ? "Feedback" : String(selection.choice || "").trim();
    const feedbackText = String(selection.comment || selection.feedbackText || "").trim().slice(0, 800);

    if (!question) throw httpError(404, "Question not found.");
    if (!isFeedback && !question.options.includes(choice)) throw httpError(400, `Choose an option for ${question.title}.`);
    if (db.votes.some((vote) => vote.unix === unix && vote.questionId === questionId)) {
      throw httpError(409, "This player already submitted these posts.");
    }

    return {
      id: `${questionId}-${unix}`,
      unix,
      questionId,
      title: question.title,
      choice,
      feedbackText: isFeedback ? feedbackText : undefined,
      answeredAt: new Date().toISOString(),
    };
  });
}

function publicQuestion(question) {
  const revealed = isRevealOver(question);
  return { ...question, closed: isDeadlineOver(question), revealed, answer: revealed && question.kind !== "feedback" ? question.answer : null };
}

function publicVote(db, vote) {
  const question = db.questions.find((item) => item.id === vote.questionId);
  const revealed = question ? isRevealOver(question) : false;
  const isFeedback = question?.kind === "feedback";
  const correct = Boolean(!isFeedback && revealed && question && question.answer === vote.choice);
  return {
    ...vote,
    revealed,
    correct,
    correctAnswer: !isFeedback && revealed && question ? question.answer : null,
    bonusPoints: question?.bonusPoints || 0,
    points: correct ? db.settings.basePoints + (question?.bonusPoints || 0) : 0,
  };
}

function adminVote(db, vote) {
  const question = db.questions.find((item) => item.id === vote.questionId);
  const isFeedback = question?.kind === "feedback";
  const correct = Boolean(!isFeedback && question && question.answer === vote.choice);

  return {
    ...vote,
    title: question?.title || vote.title,
    revealed: true,
    correct,
    correctAnswer: !isFeedback && question ? question.answer : null,
    bonusPoints: question?.bonusPoints || 0,
    points: correct ? db.settings.basePoints + (question?.bonusPoints || 0) : 0,
  };
}

function buildLeaderboard(db) {
  const currentPlayers = Object.values(db.players).map((player) => {
    const votes = db.votes.filter((vote) => vote.unix === player.unix).map((vote) => publicVote(db, vote));
    return {
      ...player,
      points: votes.reduce((total, vote) => total + vote.points, 0),
      finishedAt: latestAnsweredAt(votes),
    };
  });
  const currentByName = new Map(currentPlayers.map((player) => [normalizeUsername(player.screenName), player]));
  const imported = db.importedLeaders.map((leader) => {
    const match = currentByName.get(normalizeUsername(leader.screenName));
    if (!match) return leader;
    currentByName.delete(normalizeUsername(leader.screenName));
    return {
      ...leader,
      unix: match.unix,
      realName: match.realName,
      points: leader.points + match.points,
      finishedAt: match.finishedAt,
    };
  });
  const ranked = [...imported, ...currentByName.values()]
    .filter((leader) => leader.points > 0)
    .sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return (a.rank || Number.POSITIVE_INFINITY) - (b.rank || Number.POSITIVE_INFINITY);
  });
  const rankedWithPlaces = assignLeaderboardPlaces(ranked);
  return rankedWithPlaces
    .filter((leader) => leader.place <= db.settings.leaderboardMaxRank)
    .map((leader) => ({
      place: leader.place,
      screenName: leader.screenName,
      points: leader.points,
    }));
}

function buildAdminLeaderboard(db) {
  const playerEntries = new Map(Object.values(db.players || {}).map((player) => [player.unix, player]));
  (db.votes || []).forEach((vote) => {
    if (playerEntries.has(vote.unix)) return;
    playerEntries.set(vote.unix, {
      unix: vote.unix,
      email: `${vote.unix}@williams.edu`,
      instagram: vote.unix,
      screenName: vote.unix,
    });
  });

  const ranked = [...playerEntries.values()].map((player) => {
    const votes = (db.votes || []).filter((vote) => vote.unix === player.unix).map((vote) => adminVote(db, vote));
    return {
      unix: player.unix,
      email: player.email,
      instagram: player.instagram || player.screenName,
      screenName: player.screenName,
      points: votes.reduce((total, vote) => total + vote.points, 0),
      votes: votes.length,
      correct: votes.filter((vote) => vote.correct).length,
      finishedAt: latestAnsweredAt(votes),
    };
  }).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.correct !== a.correct) return b.correct - a.correct;
    return String(a.instagram).localeCompare(String(b.instagram));
  });

  return assignLeaderboardPlaces(ranked);
}

function buildAdminPlayerDetail(db, player) {
  const history = (db.votes || [])
    .filter((vote) => vote.unix === player.unix)
    .map((vote) => adminVote(db, vote));
  const achievements = buildAchievements(db, player.unix);
  const cheers = buildCheers(db, player.unix);
  const leaderboardEntry = buildAdminLeaderboard(db).find((leader) => leader.unix === player.unix);

  return {
    player: publicPlayer(player),
    leaderboardEntry,
    history,
    achievements,
    cheers,
  };
}

function buildAchievements(db, unix) {
  const votes = db.votes.filter((vote) => vote.unix === unix).map((vote) => publicVote(db, vote));
  const questionVotes = votes.filter((vote) => {
    const question = db.questions.find((item) => item.id === vote.questionId);
    return question?.kind !== "feedback";
  });
  const feedbackVotes = votes.filter((vote) => {
    const question = db.questions.find((item) => item.id === vote.questionId);
    return question?.kind === "feedback";
  });
  const revealedVotes = questionVotes.filter((vote) => vote.revealed);
  const correctVotes = revealedVotes.filter((vote) => vote.correct);
  const locationQuestions = db.questions.filter((question) => question.kind !== "feedback");
  const questionCount = locationQuestions.length;
  const finalScore = votes.reduce((total, vote) => total + vote.points, 0);
  const leaderboardEntry = buildLeaderboard(db).find((leader) => normalizeUsername(leader.screenName) === normalizeUsername(db.players[unix]?.screenName));
  const firstCorrectIndex = questionVotes.findIndex((vote) => vote.correct);
  const maxStreak = longestCorrectStreak(db, questionVotes);
  const answeredQuestionIds = new Set(questionVotes.map((vote) => vote.questionId));
  const firstQuestionAnswered = locationQuestions[0] ? answeredQuestionIds.has(locationQuestions[0].id) : false;
  const halfTourCount = Math.ceil(questionCount / 2);
  const bonusHunter = correctVotes.some((vote) => vote.bonusPoints > 0);
  const suggestionLeft = feedbackVotes.some((vote) => String(vote.feedbackText || "").trim().length > 0);
  const streakAchievements = Array.from({ length: Math.max(0, questionCount - 1) }, (_, index) => {
    const length = index + 2;
    return achievement(
      `streak-${length}`,
      `${length} Streak`,
      length === questionCount ? "🔥" : "⚡",
      `Award for guessing ${length} correct locations in a row.`,
      maxStreak >= length
    );
  });

  return [
    achievement("joined", "Joined the Map", "💜", "Award for joining Where Is This Williams.", Boolean(db.players[unix])),
    achievement("first-eye", "First Eye", "👁️", "Award for making your first campus guess.", questionVotes.length >= 1),
    achievement("opening-look", "Opening Look", "🚪", "Award for answering the first posted location.", firstQuestionAnswered),
    achievement("campus-scout", "Campus Scout", "🗺️", "Award for answering 3 photos.", questionVotes.length >= 3),
    achievement("halfway-hiker", "Halfway Hiker", "🥾", "Award for answering at least half of the location photos.", questionVotes.length >= halfTourCount && questionCount > 0),
    achievement("full-tour", "Full Tour", "🎒", "Award for answering every location photo.", questionVotes.length >= questionCount && questionCount > 0),
    achievement("speed-runner", "Speed Runner", "⏱️", "Award for finishing the full run, including the final suggestion card.", votes.length >= db.questions.length && db.questions.length > 0),
    achievement("sharp-eye", "Sharp Eye", "🎯", "Award for guessing one revealed photo correctly.", correctVotes.length >= 1),
    achievement("campus-eye", "Campus Eye", "🏛️", "Award for guessing 3 revealed photos correctly.", correctVotes.length >= 3),
    ...streakAchievements,
    achievement("bonus-hunter", "Bonus Hunter", "💰", "Award for earning bonus points on a harder location.", bonusHunter),
    achievement("perfect-round", "Perfect Round", "💎", "Award for getting every revealed location right.", revealedVotes.length > 0 && correctVotes.length === revealedVotes.length),
    achievement("comeback", "Comeback Kid", "🔁", "Award for getting one right after a nice try.", firstCorrectIndex > 0),
    achievement("better-place", "Making the App Better", "🛠️", "Award for leaving a suggestion that can improve the app.", suggestionLeft),
    achievement("top-twelve", "Top 12 Glow", "⭐", "Award for reaching the public Top 12 leaderboard.", Boolean(leaderboardEntry) && finalScore > 0),
    achievement("top-mapper", "Top Mapper", "🧭", "Award for holding the number one rank at least once.", leaderboardEntry?.place === 1 && finalScore > 0),
  ];
}

function achievement(id, title, sticker, description, unlocked) {
  return { id, title, sticker, description, unlocked };
}

function longestCorrectStreak(db, votes) {
  const votesByQuestion = new Map(votes.map((vote) => [vote.questionId, vote]));
  let longest = 0;
  let current = 0;

  for (const question of db.questions.filter((item) => item.kind !== "feedback")) {
    const vote = votesByQuestion.get(question.id);
    if (vote?.revealed && vote.correct) {
      current += 1;
      longest = Math.max(longest, current);
    } else if (vote?.revealed) {
      current = 0;
    }
  }

  return longest;
}

function buildCheers(db, unix) {
  const referralCount = Object.values(db.players).filter((player) => player.referredBy === unix).length;
  return [
    achievement("happy-anniversary", "Happy Anniversary!", "🎈", "Celebrate a Where Is This Williams milestone.", false),
    { ...achievement("successful-referral", "Successful Referral!", "🎟️", "Invite new members with your referral link.", referralCount > 0), count: referralCount },
  ];
}

function findPlayer(db, lookup) {
  const normalized = normalizeUsername(lookup).toLowerCase();
  if (!normalized) return null;
  return Object.values(db.players || {}).find((player) => (
    player.unix === normalized
    || String(player.email || "").toLowerCase() === normalized
    || normalizeUsername(player.instagram || player.screenName).toLowerCase() === normalized
  ));
}

async function buildAdminStats(db) {
  const analytics = await readAnalytics();
  const players = Object.values(db.players || {});
  const votes = db.votes || [];
  const referrals = players.filter((player) => player.referredBy).length;
  const pageVisits = Object.entries(analytics.pages || {})
    .map(([page, visits]) => ({ page, visits }))
    .sort((a, b) => b.visits - a.visits);

  return {
    totalVisits: analytics.totalVisits || 0,
    uniqueVisitors: Object.keys(analytics.visitors || {}).length,
    players: players.length,
    votes: votes.length,
    uniqueVoters: new Set(votes.map((vote) => vote.unix)).size,
    referrals,
    pageVisits,
    recentVisits: analytics.recentVisits || [],
    updatedAt: new Date().toISOString(),
  };
}

function ensureAnalytics(db) {
  db.totalVisits = Number(db.totalVisits || 0);
  if (!db.pages) db.pages = {};
  if (!db.visitors) db.visitors = {};
  if (!Array.isArray(db.recentVisits)) db.recentVisits = [];
  return db;
}

function emptyAnalytics() {
  return {
    totalVisits: 0,
    pages: {},
    visitors: {},
    recentVisits: [],
  };
}

function normalizePlayer(body) {
  const email = String(body.email || "").trim().toLowerCase();
  const unix = String(body.unix || email.split("@")[0] || "").trim().toLowerCase();
  const instagram = normalizeInstagram(body.instagram || body.screenName);
  const referredBy = String(body.referredBy || "").trim().toLowerCase();
  const realName = instagram;
  const screenName = instagram;
  if (!unix || !email || !instagram) throw httpError(400, "Williams email and Instagram username are required.");
  if (!email.endsWith("@williams.edu")) throw httpError(400, "Use a Williams email address.");
  return {
    unix,
    email,
    realName,
    screenName,
    instagram,
    referredBy: referredBy && referredBy !== unix ? referredBy : undefined,
    avatar: Object.hasOwn(body, "avatar") ? String(body.avatar || "💜") : undefined,
    avatarImage: Object.hasOwn(body, "avatarImage") ? (typeof body.avatarImage === "string" ? body.avatarImage : null) : undefined,
  };
}

function normalizeWilliamsEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) throw httpError(400, "Williams email is required.");
  if (!email.endsWith("@williams.edu")) throw httpError(400, "Use a Williams email address.");
  return email;
}

function normalizePassword(value) {
  const password = String(value || "");
  if (password.length < 8) throw httpError(400, "Use a password with at least 8 characters.");
  return password;
}

function unixFromEmail(email) {
  return normalizeWilliamsEmail(email).split("@")[0];
}

function normalizeRedirectUrl(value, req) {
  const fallback = `http://${req.headers.host}/login.html`;
  const redirectTo = String(value || fallback).trim();
  try {
    const parsed = new URL(redirectTo);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Invalid protocol");
    return parsed.toString();
  } catch {
    return fallback;
  }
}

async function verifySupabaseAccessToken(accessToken) {
  if (!isSupabaseAuthConfigured()) throw httpError(500, "Supabase auth is not configured yet.");
  if (!accessToken) throw httpError(401, "Login token required.");

  let user;
  try {
    user = await supabaseAuthFetch("/auth/v1/user", { accessToken });
  } catch {
    throw httpError(401, "Login link expired. Send yourself a new login link.");
  }

  const email = normalizeWilliamsEmail(user?.email);
  return { email, unix: unixFromEmail(email), id: user.id };
}

async function passwordLogin(email, password) {
  try {
    return await supabaseAuthFetch("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password },
    });
  } catch {
    throw httpError(401, "Email or password is incorrect, or your email has not been confirmed yet.");
  }
}

async function passwordSignup(email, password, instagram) {
  try {
    return await supabaseAuthFetch("/auth/v1/signup", {
      method: "POST",
      body: {
        email,
        password,
        data: { instagram },
      },
    });
  } catch {
    throw httpError(409, "This email may already be signed up. Try logging in instead.");
  }
}

async function exchangeSupabaseCode(code) {
  if (!isSupabaseAuthConfigured()) throw httpError(500, "Supabase auth is not configured yet.");
  const authCode = String(code || "").trim();
  if (!authCode) throw httpError(401, "Login code required.");

  let session;
  try {
    session = await supabaseAuthFetch("/auth/v1/token?grant_type=authorization_code", {
      method: "POST",
      body: { auth_code: authCode },
    });
  } catch {
    throw httpError(401, "Login link expired or already used. Send yourself a fresh login link.");
  }

  if (!session?.access_token) throw httpError(401, "Login link did not return a session. Send yourself a fresh login link.");
  return session.access_token;
}

async function authUserFromRequest(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, "Login token required.");
  return verifySupabaseAccessToken(match[1]);
}

async function requirePlayerAuth(req, unix) {
  if (!isSupabaseAuthConfigured()) return null;
  const authUser = await authUserFromRequest(req);
  const requestedUnix = String(unix || "").trim().toLowerCase();
  if (!requestedUnix || requestedUnix !== authUser.unix) throw httpError(403, "You can only submit answers for your own account.");
  return authUser;
}

function upsertVerifiedPlayer(db, { email, referredBy = "" }) {
  const normalizedEmail = normalizeWilliamsEmail(email);
  const unix = unixFromEmail(normalizedEmail);
  const existingPlayer = db.players[unix];
  const safeReferrer = referredBy && referredBy !== unix ? referredBy : existingPlayer?.referredBy;
  db.players[unix] = {
    ...existingPlayer,
    unix,
    email: normalizedEmail,
    realName: existingPlayer?.realName || existingPlayer?.screenName || existingPlayer?.instagram || "",
    screenName: existingPlayer?.screenName || existingPlayer?.instagram || "",
    instagram: existingPlayer?.instagram || existingPlayer?.screenName || "",
    avatar: existingPlayer?.avatar || "💜",
    avatarImage: existingPlayer?.avatarImage,
    referredBy: safeReferrer || undefined,
    verified: true,
  };
  return db.players[unix];
}

function hasDisplayProfile(player) {
  return Boolean(normalizeInstagram(player?.instagram || player?.screenName));
}

function assertInstagramAvailable(db, unix, instagram) {
  const normalizedInstagram = normalizeUsername(instagram).toLowerCase();
  const duplicate = Object.values(db.players || {}).find((player) => {
    return player.unix !== unix && normalizeUsername(player.instagram || player.screenName).toLowerCase() === normalizedInstagram;
  });
  if (duplicate) throw httpError(409, "That Instagram username is already connected to another Williams email.");
}

function publicPlayer(player) {
  return {
    unix: player.unix,
    email: player.email,
    realName: player.realName,
    screenName: player.screenName,
    instagram: player.instagram || player.screenName,
    avatar: player.avatar,
    avatarImage: player.avatarImage,
    verified: Boolean(player.verified),
  };
}

function normalizeQuestion(body) {
  const id = String(body.id || "").trim();
  const title = String(body.title || "").trim();
  const image = String(body.image || "").trim();
  const answer = String(body.answer || "").trim();
  const options = Array.isArray(body.options) ? body.options.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const postedAt = String(body.postedAt || "").trim();
  const deadlineAt = String(body.deadlineAt || "").trim();
  const revealAt = String(body.revealAt || body.deadlineAt || "").trim();
  const kind = String(body.kind || "question").trim();
  const commentPrompt = String(body.commentPrompt || "").trim();
  const bonusPoints = Number(body.bonusPoints || 0);

  if (!id || !title || !image || !answer || options.length < 2 || !postedAt || !deadlineAt) {
    throw httpError(400, "Question id, title, image, answer, options, postedAt, and deadlineAt are required.");
  }

  if (!options.includes(answer)) options.unshift(answer);
  return { id, title, image, postedAt, answer, options, bonusPoints, deadlineAt, revealAt, kind, commentPrompt };
}

async function readRankingCsv() {
  if (!existsSync(rankingCsvPath)) return [];
  const rows = parseCsv(await readFile(rankingCsvPath, "utf8"));
  const header = rows[2] || [];
  const scoreNames = header.slice(3);

  return rows.slice(3).filter((row) => row.some(Boolean)).map((row) => {
    const values = Object.fromEntries(header.map((key, index) => [key, row[index]]));
    const username = values.Username;
    return {
      rank: Number(values.Rank),
      unix: `spring26-${username.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      screenName: username,
      realName: "Spring '26 Player",
      points: Number(values.Total),
      scores: Object.fromEntries(scoreNames.map((name) => [name, Number(values[name] || 0)])),
    };
  });
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"" && quoted && next === "\"") {
      field += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function mergeScores(seedScores = {}, voteScores = {}) {
  const merged = { ...seedScores };
  Object.entries(voteScores).forEach(([key, value]) => {
    merged[key] = (merged[key] || 0) + value;
  });
  return merged;
}

function assignLeaderboardPlaces(leaders) {
  let previousPoints = null;
  let previousPlace = 0;
  return leaders.map((leader, index) => {
    const place = leader.points === previousPoints ? previousPlace : index + 1;
    previousPoints = leader.points;
    previousPlace = place;
    return { ...leader, place };
  });
}

function latestAnsweredAt(votes) {
  return votes.reduce((latest, vote) => {
    if (!vote.answeredAt) return latest;
    if (!latest || new Date(vote.answeredAt) > new Date(latest)) return vote.answeredAt;
    return latest;
  }, null);
}

function isDeadlineOver(question) {
  return Date.now() >= new Date(question.deadlineAt).getTime();
}

function isPosted(question) {
  return Date.now() >= new Date(question.postedAt).getTime();
}

function isRevealOver(question) {
  return Date.now() >= new Date(question.revealAt || question.deadlineAt).getTime();
}

function normalizeInstagram(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function normalizeUsername(username) {
  return String(username || "").trim().replace(/^@+/, "");
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function requireAdmin(req) {
  if (req.headers["x-admin-token"] !== adminToken) throw httpError(401, "Admin token required.");
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
