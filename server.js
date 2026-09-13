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
  const questionCount = db.questions.filter((question) => question.kind !== "feedback").length;
  const finalScore = votes.reduce((total, vote) => total + vote.points, 0);
  const leaderboardEntry = buildLeaderboard(db).find((leader) => normalizeUsername(leader.screenName) === normalizeUsername(db.players[unix]?.screenName));
  const firstCorrectIndex = questionVotes.findIndex((vote) => vote.correct);

  return [
    achievement("first-eye", "First Eye", "👁️", "Made your first guess.", questionVotes.length >= 1),
    achievement("campus-scout", "Campus Scout", "🗺️", "Answered 3 photos.", questionVotes.length >= 3),
    achievement("full-tour", "Full Tour", "🎒", "Answered every location photo.", questionVotes.length >= questionCount && questionCount > 0),
    achievement("speed-runner", "Speed Runner", "⚡", "Finished the whole run.", votes.length >= db.questions.length && db.questions.length > 0),
    achievement("sharp-eye", "Sharp Eye", "🎯", "Guessed one revealed photo right.", correctVotes.length >= 1),
    achievement("campus-eye", "Campus Eye", "🏛️", "Guessed 3 revealed photos right.", correctVotes.length >= 3),
    achievement("perfect-round", "Perfect Round", "💎", "Got every revealed location right.", revealedVotes.length > 0 && correctVotes.length === revealedVotes.length),
    achievement("comeback", "Comeback", "🔁", "Got one right after a nice try.", firstCorrectIndex > 0),
    achievement("feedback-friend", "Feedback Friend", "💬", "Left final feedback.", feedbackVotes.some((vote) => vote.feedbackText)),
    achievement("top-twelve", "Top 12 Glow", "⭐", "Reached the public Top 12 board.", Boolean(leaderboardEntry) && finalScore > 0),
    achievement("top-mapper", "Top Mapper", "🧭", "Held the #1 rank.", leaderboardEntry?.place === 1 && finalScore > 0),
  ];
}

function achievement(id, title, sticker, description, unlocked) {
  return { id, title, sticker, description, unlocked };
}

function buildCheers(db, unix) {
  const referralCount = Object.values(db.players).filter((player) => player.referredBy === unix).length;
  return [
    achievement("happy-anniversary", "Happy Anniversary!", "🎈", "Celebrate a Where Is This Williams milestone.", false),
    { ...achievement("successful-referral", "Successful Referral!", "🎟️", "Invite new members with your referral link.", referralCount > 0), count: referralCount },
  ];
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
