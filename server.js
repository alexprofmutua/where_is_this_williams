import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "data", "db.json");
const rankingCsvPath = path.join(__dirname, "assests", "spring26-ranking.csv");
const port = Number(process.env.PORT || 3000);
const adminToken = process.env.ADMIN_TOKEN || "change-me";

const mimeTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
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

    await serveStatic(res, url.pathname);
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
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function writeDb(db) {
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);
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

  if (req.method === "POST" && url.pathname === "/api/players") {
    const player = normalizePlayer(await readJson(req));
    const existingPlayer = db.players[player.unix];
    const keepsVerification = existingPlayer?.verified && existingPlayer.email === player.email;
    const verificationCode = keepsVerification ? existingPlayer.verificationCode : createVerificationCode();
    db.players[player.unix] = {
      ...existingPlayer,
      ...player,
      verified: Boolean(keepsVerification),
      verificationCode,
      verificationSentAt: keepsVerification
        ? existingPlayer.verificationSentAt
        : new Date().toISOString(),
    };
    await writeDb(db);
    sendJson(res, 200, { player: publicPlayer(db.players[player.unix]) });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/players/")) {
    const unix = decodeURIComponent(url.pathname.split("/").at(-1)).toLowerCase();
    sendJson(res, 200, { player: db.players[unix] ? publicPlayer(db.players[unix]) : null });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/resend-verification") {
    const body = await readJson(req);
    const unix = String(body.unix || "").trim().toLowerCase();
    const player = db.players[unix];

    if (!player) throw httpError(404, "Player not found.");
    if (player.verified) throw httpError(400, "This player is already verified.");

    const secondsLeft = secondsUntilResend(player);
    if (secondsLeft > 0) throw httpError(429, `Please wait ${secondsLeft}s before requesting another code.`);

    player.verificationCode = createVerificationCode();
    player.verificationSentAt = new Date().toISOString();
    await writeDb(db);
    sendJson(res, 200, { player: publicPlayer(player) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/verify-player") {
    const body = await readJson(req);
    const unix = String(body.unix || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const player = db.players[unix];

    if (!player) throw httpError(404, "Player not found.");
    if (player.verificationCode !== code) throw httpError(400, "Verification code is incorrect.");

    player.verified = true;
    await writeDb(db);
    sendJson(res, 200, { player: publicPlayer(player) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/votes") {
    const vote = createVote(db, await readJson(req));
    db.votes.push(vote);
    await writeDb(db);
    sendJson(res, 201, { vote: publicVote(db, vote) });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/history/")) {
    const unix = decodeURIComponent(url.pathname.split("/").at(-1)).toLowerCase();
    sendJson(res, 200, {
      votes: db.votes.filter((vote) => vote.unix === unix).map((vote) => publicVote(db, vote)),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    sendJson(res, 200, { columns: scoreColumns(db), leaders: buildLeaderboard(db) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/podium") {
    sendJson(res, 200, { terms: db.termWinners || [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/questions") {
    requireAdmin(req);
    sendJson(res, 200, { questions: db.questions });
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

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(__dirname, requested));

  if (!filePath.startsWith(__dirname)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function createVote(db, body) {
  const unix = String(body.unix || "").trim().toLowerCase();
  const questionId = String(body.questionId || "").trim();
  const choice = String(body.choice || "").trim();
  const question = db.questions.find((item) => item.id === questionId);

  if (!db.players[unix]) throw httpError(400, "Create a player profile first.");
  if (!db.players[unix].verified) throw httpError(403, "Verify your Williams email before voting.");
  if (!question) throw httpError(404, "Question not found.");
  if (isDeadlineOver(question)) throw httpError(400, "Voting is closed for this photo.");
  if (!question.options.includes(choice)) throw httpError(400, "Invalid choice.");
  if (db.votes.some((vote) => vote.unix === unix && vote.questionId === questionId)) {
    throw httpError(409, "This player already voted for this photo.");
  }

  return { id: `${questionId}-${unix}`, unix, questionId, title: question.title, choice, answeredAt: new Date().toISOString() };
}

function publicQuestion(question) {
  const revealed = isDeadlineOver(question);
  return { ...question, revealed, answer: revealed ? question.answer : null };
}

function publicVote(db, vote) {
  const question = db.questions.find((item) => item.id === vote.questionId);
  const revealed = question ? isDeadlineOver(question) : false;
  const correct = Boolean(revealed && question && question.answer === vote.choice);
  return {
    ...vote,
    revealed,
    correct,
    correctAnswer: revealed && question ? question.answer : null,
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
      scores: Object.fromEntries(votes.map((vote) => [vote.correctAnswer || vote.title, vote.points])),
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
      scores: mergeScores(leader.scores, match.scores),
    };
  });
  const leaders = [...imported, ...currentByName.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return (a.rank || Number.POSITIVE_INFINITY) - (b.rank || Number.POSITIVE_INFINITY);
  });
  return leaders.filter((leader, index) => (leader.rank || index + 1) <= db.settings.leaderboardMaxRank);
}

function scoreColumns(db) {
  const columns = new Set();
  db.importedLeaders.forEach((leader) => Object.keys(leader.scores || {}).forEach((key) => columns.add(key)));
  db.questions.forEach((question) => columns.add(question.answer));
  return [...columns];
}

function normalizePlayer(body) {
  const unix = String(body.unix || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const realName = String(body.realName || "").trim();
  const screenName = String(body.screenName || "").trim();
  if (!unix || !email || !realName || !screenName) throw httpError(400, "Unix, Williams email, real name, and screen name are required.");
  if (!email.endsWith("@williams.edu")) throw httpError(400, "Use a Williams email address.");
  return {
    unix,
    email,
    realName,
    screenName,
    avatar: String(body.avatar || "💜"),
    avatarImage: typeof body.avatarImage === "string" ? body.avatarImage : undefined,
  };
}

function publicPlayer(player) {
  return {
    unix: player.unix,
    email: player.email,
    realName: player.realName,
    screenName: player.screenName,
    avatar: player.avatar,
    avatarImage: player.avatarImage,
    verified: Boolean(player.verified),
    verificationSentAt: player.verificationSentAt,
    verificationCode: process.env.NODE_ENV === "production" ? undefined : player.verificationCode,
  };
}

function createVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function secondsUntilResend(player) {
  const sentAt = new Date(player.verificationSentAt || 0).getTime();
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + 60000 - Date.now()) / 1000));
}

function normalizeQuestion(body) {
  const id = String(body.id || "").trim();
  const title = String(body.title || "").trim();
  const image = String(body.image || "").trim();
  const answer = String(body.answer || "").trim();
  const options = Array.isArray(body.options) ? body.options.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const postedAt = String(body.postedAt || "").trim();
  const deadlineAt = String(body.deadlineAt || "").trim();
  const bonusPoints = Number(body.bonusPoints || 0);

  if (!id || !title || !image || !answer || options.length < 2 || !postedAt || !deadlineAt) {
    throw httpError(400, "Question id, title, image, answer, options, postedAt, and deadlineAt are required.");
  }

  if (!options.includes(answer)) options.unshift(answer);
  return { id, title, image, postedAt, answer, options, bonusPoints, deadlineAt };
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

function isDeadlineOver(question) {
  return Date.now() >= new Date(question.deadlineAt).getTime();
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function requireAdmin(req) {
  if (req.headers["x-admin-token"] !== adminToken) throw httpError(401, "Admin token required.");
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
