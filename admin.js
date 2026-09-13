const form = document.querySelector("#admin-question-form");
const statusText = document.querySelector("#admin-status");
const refreshStatsButton = document.querySelector("#refresh-stats-button");
const statsStatus = document.querySelector("#stats-status");
const adminStatsGrid = document.querySelector("#admin-stats-grid");
const pageStatsBody = document.querySelector("#page-stats-body");
const loadPlayerAchievementsButton = document.querySelector("#load-player-achievements-button");
const playerAchievementsStatus = document.querySelector("#player-achievements-status");
const adminCollectionPanel = document.querySelector("#admin-collection-panel");
const adminPlayerMeta = document.querySelector("#admin-player-meta");
const adminAchievementCount = document.querySelector("#admin-achievement-count");
const adminAchievementList = document.querySelector("#admin-achievement-list");
const adminCheersCount = document.querySelector("#admin-cheers-count");
const adminCheersList = document.querySelector("#admin-cheers-list");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = document.querySelector("#admin-token").value;
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
    const response = await fetch("/api/admin/questions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save question.");
    statusText.textContent = "Question saved.";
    form.reset();
  } catch (error) {
    statusText.textContent = error.message;
  }
});

refreshStatsButton?.addEventListener("click", loadAdminStats);
loadPlayerAchievementsButton?.addEventListener("click", loadPlayerAchievements);

async function loadAdminStats() {
  const token = document.querySelector("#admin-token").value;
  if (!token) {
    statsStatus.textContent = "Enter your admin token first.";
    return;
  }

  try {
    statsStatus.textContent = "Loading stats...";
    const response = await fetch("/api/admin/stats", {
      headers: { "x-admin-token": token },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load stats.");
    renderAdminStats(result.stats);
    statsStatus.textContent = `Updated ${new Date(result.stats.updatedAt).toLocaleTimeString()}.`;
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

async function loadPlayerAchievements() {
  const token = document.querySelector("#admin-token").value;
  const lookup = document.querySelector("#admin-player-lookup").value.trim();
  if (!token) {
    playerAchievementsStatus.textContent = "Enter your admin token first.";
    return;
  }
  if (!lookup) {
    playerAchievementsStatus.textContent = "Enter a player email, unix, or Instagram username.";
    return;
  }

  try {
    playerAchievementsStatus.textContent = "Loading collection...";
    const response = await fetch(`/api/admin/player-achievements?player=${encodeURIComponent(lookup)}`, {
      headers: { "x-admin-token": token },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load player collection.");
    renderPlayerCollection(result);
    playerAchievementsStatus.textContent = `Loaded @${result.player.instagram || result.player.screenName}.`;
  } catch (error) {
    adminCollectionPanel.classList.add("hidden");
    playerAchievementsStatus.textContent = error.message;
  }
}

function renderPlayerCollection({ player, achievements, cheers }) {
  adminCollectionPanel.classList.remove("hidden");
  const unlockedAchievements = achievements.filter((item) => item.unlocked).length;
  const unlockedCheers = cheers.filter((item) => item.unlocked).length;
  adminPlayerMeta.textContent = `${player.email} · @${player.instagram || player.screenName}`;
  adminAchievementCount.textContent = `Achievements (${unlockedAchievements}/${achievements.length})`;
  adminCheersCount.textContent = `Cheers (${unlockedCheers}/${cheers.length})`;
  adminAchievementList.innerHTML = achievements.map(renderStickerCard).join("");
  adminCheersList.innerHTML = cheers.map(renderStickerCard).join("");
}

function renderStickerCard(item) {
  return `
    <article class="achievement-card ${item.unlocked ? "unlocked" : "locked"}">
      <span>${escapeHtml(item.sticker)}${item.count ? `<b>${escapeHtml(item.count)}</b>` : ""}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <em>${escapeHtml(item.description)}</em>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
