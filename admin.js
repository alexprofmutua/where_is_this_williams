const form = document.querySelector("#admin-question-form");
const statusText = document.querySelector("#admin-status");
const adminTokenInput = document.querySelector("#admin-token");
const loadDashboardButton = document.querySelector("#load-admin-dashboard-button");
const dashboardStatus = document.querySelector("#admin-dashboard-status");
const refreshLeaderboardButton = document.querySelector("#refresh-admin-leaderboard-button");
const leaderboardStatus = document.querySelector("#admin-leaderboard-status");
const leaderboardBody = document.querySelector("#admin-leaderboard-body");
const refreshStatsButton = document.querySelector("#refresh-stats-button");
const statsStatus = document.querySelector("#stats-status");
const adminStatsGrid = document.querySelector("#admin-stats-grid");
const pageStatsBody = document.querySelector("#page-stats-body");
const refreshPodiumButton = document.querySelector("#refresh-admin-podium-button");
const podiumStatus = document.querySelector("#admin-podium-status");
const currentTopGrid = document.querySelector("#admin-current-top");
const podiumGallery = document.querySelector("#admin-podium-gallery");
const loadPlayerAchievementsButton = document.querySelector("#load-player-achievements-button");
const playerAchievementsStatus = document.querySelector("#player-achievements-status");
const adminCollectionPanel = document.querySelector("#admin-collection-panel");
const adminPlayerDetailTitle = document.querySelector("#admin-player-detail-title");
const adminPlayerDetailCopy = document.querySelector("#admin-player-detail-copy");
const adminPlayerSummary = document.querySelector("#admin-player-summary");
const adminPlayerHistoryBody = document.querySelector("#admin-player-history-body");
const adminPlayerMeta = document.querySelector("#admin-player-meta");
const adminAchievementCount = document.querySelector("#admin-achievement-count");
const adminAchievementList = document.querySelector("#admin-achievement-list");
const adminCheersCount = document.querySelector("#admin-cheers-count");
const adminCheersList = document.querySelector("#admin-cheers-list");

form.addEventListener("submit", saveQuestion);
loadDashboardButton?.addEventListener("click", loadDashboard);
refreshLeaderboardButton?.addEventListener("click", loadAdminLeaderboard);
refreshStatsButton?.addEventListener("click", loadAdminStats);
refreshPodiumButton?.addEventListener("click", loadAdminPodium);
loadPlayerAchievementsButton?.addEventListener("click", () => {
  const lookup = document.querySelector("#admin-player-lookup").value.trim();
  loadPlayerDetail(lookup);
});

async function saveQuestion(event) {
  event.preventDefault();
  const token = getAdminToken();
  const payload = {
    id: document.querySelector("#admin-id").value.trim(),
    title: document.querySelector("#admin-title").value.trim(),
    image: document.querySelector("#admin-image").value.trim(),
    options: document.querySelector("#admin-options").value.split("\n").map((item) => item.trim()).filter(Boolean),
    answer: document.querySelector("#admin-answer").value.trim(),
    postedAt: document.querySelector("#admin-posted").value,
    deadlineAt: document.querySelector("#admin-deadline").value,
    revealAt: document.querySelector("#admin-reveal").value,
    bonusPoints: Number(document.querySelector("#admin-bonus").value || 0),
  };

  try {
    if (!token) throw new Error("Enter your admin token first.");
    const result = await adminFetch("/api/admin/questions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    statusText.textContent = `Question saved: ${result.question.title}.`;
    form.reset();
  } catch (error) {
    statusText.textContent = error.message;
  }
}

async function loadDashboard() {
  if (!getAdminToken()) {
    dashboardStatus.textContent = "Enter your admin token first.";
    return;
  }

  dashboardStatus.textContent = "Loading admin dashboard...";
  await Promise.allSettled([loadAdminLeaderboard(), loadAdminStats(), loadAdminPodium()]);
  dashboardStatus.textContent = "Dashboard loaded.";
}

async function loadAdminLeaderboard() {
  try {
    leaderboardStatus.textContent = "Loading leaderboard...";
    const { leaders } = await adminFetch("/api/admin/leaderboard");
    leaderboardBody.innerHTML = leaders.length
      ? leaders.map((leader) => `
          <tr class="clickable-row" data-player="${escapeHtml(leader.unix)}">
            <td>${leader.place}</td>
            <td>@${escapeHtml(leader.instagram || leader.screenName)}</td>
            <td>${escapeHtml(leader.email)}</td>
            <td>${leader.points}</td>
            <td>${leader.votes}</td>
            <td>${leader.correct}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="6">No players yet.</td></tr>`;
    leaderboardBody.querySelectorAll("[data-player]").forEach((row) => {
      row.addEventListener("click", () => loadPlayerDetail(row.dataset.player));
    });
    leaderboardStatus.textContent = `${leaders.length} players loaded.`;
  } catch (error) {
    leaderboardStatus.textContent = error.message;
  }
}

async function loadAdminStats() {
  try {
    statsStatus.textContent = "Loading stats...";
    const { stats } = await adminFetch("/api/admin/stats");
    renderAdminStats(stats);
    statsStatus.textContent = `Updated ${new Date(stats.updatedAt).toLocaleTimeString()}.`;
  } catch (error) {
    statsStatus.textContent = error.message;
  }
}

function renderAdminStats(stats) {
  const cards = [
    ["Total visits", stats.totalVisits],
    ["Unique visitors", stats.uniqueVisitors],
    ["Players", stats.players],
    ["Votes", stats.votes],
    ["Unique voters", stats.uniqueVoters],
    ["Referrals", stats.referrals],
  ];

  adminStatsGrid.innerHTML = cards.map(([label, value]) => `
    <article class="admin-stat-card">
      <strong>${value}</strong>
      <span>${label}</span>
    </article>
  `).join("");

  pageStatsBody.innerHTML = stats.pageVisits.length
    ? stats.pageVisits.map((item) => `<tr><td>${escapeHtml(item.page)}</td><td>${item.visits}</td></tr>`).join("")
    : `<tr><td colspan="2">No page visits recorded yet.</td></tr>`;
}

async function loadAdminPodium() {
  try {
    podiumStatus.textContent = "Loading podium...";
    const { terms, currentTop } = await adminFetch("/api/admin/podium");
    currentTopGrid.innerHTML = currentTop.length
      ? currentTop.map((leader) => `
          <article class="admin-stat-card">
            <strong>#${leader.place}</strong>
            <span>@${escapeHtml(leader.instagram || leader.screenName)} · ${leader.points} pts</span>
          </article>
        `).join("")
      : `<article class="admin-stat-card"><strong>0</strong><span>No scored players yet</span></article>`;

    podiumGallery.innerHTML = terms.length
      ? terms.map((term) => `
          <section class="term-podium">
            <h2>${escapeHtml(term.term)} ${term.finalized ? "· Finalized" : "· Draft"}</h2>
            <div class="winner-grid olympic-podium">
              ${(term.winners || []).map((winner) => `
                <article class="winner-card place-${winner.place}">
                  <img src="${escapeHtml(winner.image)}" alt="@${escapeHtml(winner.screenName)}" />
                  <div><span>${winner.place}</span><strong>@${escapeHtml(winner.screenName)}</strong><em>${winner.points} pts</em></div>
                </article>
              `).join("")}
            </div>
          </section>
        `).join("")
      : `<section class="empty-podium"><strong>No finalized podium yet.</strong><p>Final winners will appear here after you add them to the term winners data.</p></section>`;
    podiumStatus.textContent = "Podium loaded.";
  } catch (error) {
    podiumStatus.textContent = error.message;
  }
}

async function loadPlayerDetail(lookup) {
  if (!lookup) {
    playerAchievementsStatus.textContent = "Enter a player email, unix, or Instagram username.";
    return;
  }

  try {
    playerAchievementsStatus.textContent = "Loading player...";
    const result = await adminFetch(`/api/admin/player-detail?player=${encodeURIComponent(lookup)}`);
    renderPlayerDetail(result);
    document.querySelector("#admin-player-lookup").value = result.player.instagram || result.player.unix;
    document.querySelector("#admin-player-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    playerAchievementsStatus.textContent = `Loaded @${result.player.instagram || result.player.screenName}.`;
  } catch (error) {
    adminCollectionPanel.classList.add("hidden");
    playerAchievementsStatus.textContent = error.message;
  }
}

function renderPlayerDetail({ player, leaderboardEntry, history, achievements, cheers }) {
  adminCollectionPanel.classList.remove("hidden");
  const instagram = player.instagram || player.screenName;
  const unlockedAchievements = achievements.filter((item) => item.unlocked).length;
  const unlockedCheers = cheers.filter((item) => item.unlocked).length;
  const totalPoints = history.reduce((total, vote) => total + vote.points, 0);
  adminPlayerDetailTitle.textContent = `@${instagram}`;
  adminPlayerDetailCopy.textContent = `${player.email} · ${totalPoints} points · ${history.length} saved responses`;
  adminPlayerMeta.textContent = `${player.email} · @${instagram}`;
  adminAchievementCount.textContent = `Achievements (${unlockedAchievements}/${achievements.length})`;
  adminCheersCount.textContent = `Cheers (${unlockedCheers}/${cheers.length})`;
  adminPlayerSummary.innerHTML = [
    ["Rank", leaderboardEntry?.place ? `#${leaderboardEntry.place}` : "Unranked"],
    ["Score", totalPoints],
    ["Votes", history.length],
    ["Correct", history.filter((vote) => vote.correct).length],
    ["Achievements", `${unlockedAchievements}/${achievements.length}`],
    ["Cheers", `${unlockedCheers}/${cheers.length}`],
  ].map(([label, value]) => `
    <article class="admin-stat-card">
      <strong>${value}</strong>
      <span>${label}</span>
    </article>
  `).join("");
  adminPlayerHistoryBody.innerHTML = history.length
    ? history.map((vote) => `
        <tr>
          <td>${escapeHtml(vote.title)}</td>
          <td>${escapeHtml(vote.choice)}</td>
          <td>${escapeHtml(vote.correctAnswer || "Hidden until reveal")}</td>
          <td>${escapeHtml(historyResultLabel(vote))}</td>
          <td>${vote.points}</td>
          <td>${formatDate(vote.answeredAt)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6">No history yet.</td></tr>`;
  adminAchievementList.innerHTML = achievements.map(renderAdminStickerCard).join("");
  adminCheersList.innerHTML = cheers.map(renderAdminStickerCard).join("");
}

function renderAdminStickerCard(item) {
  return `
    <article class="achievement-card admin-sticker-card unlocked">
      <span>${escapeHtml(item.sticker)}${item.count ? `<b>${escapeHtml(item.count)}</b>` : ""}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <em>${escapeHtml(item.description)}</em>
      <small>${item.unlocked ? "Unlocked" : "Not unlocked yet"}</small>
    </article>
  `;
}

async function adminFetch(path, options = {}) {
  const token = getAdminToken();
  if (!token) throw new Error("Enter your admin token first.");
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      "x-admin-token": token,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Admin request failed.");
  return result;
}

function getAdminToken() {
  return adminTokenInput?.value || "";
}

function historyResultLabel(vote) {
  if (!vote.revealed) return "Pending reveal";
  if (vote.correct) return "Guessed right";
  return vote.points > 0 ? "Almost" : "Nice try";
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
