const ACTIVE_UNIX_KEY = "where-is-this-williams-active-unix";
const REMINDERS_KEY = "where-is-this-williams-reminders";
const REFERRER_KEY = "where-is-this-williams-referrer";
const AUDIO_MUTED_KEY = "where-is-this-williams-audio-muted";
const MUSIC_STARTED_AT_KEY = "where-is-this-williams-music-started-at";
const ADMIN_EMAIL = "amm22@williams.edu";
const ADMIN_INSTAGRAM = "alem_prof";

let appData = { settings: {}, questions: [] };
let activePlayer = null;
let currentQuestionIndex = 0;
let timerId = null;
let eventWindowTimerId = null;
let music = null;
let questionEndsAt = null;
let authMode = "signup";

const introScreen = document.querySelector("#intro-screen");
const quizScreen = document.querySelector("#quiz-screen");
const resultsScreen = document.querySelector("#results-screen");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const audioToggle = document.querySelector("#audio-toggle");
const aboutLink = document.querySelector('a[href="#about"]');
const aboutPanel = document.querySelector("#about");
const playerForm = document.querySelector("#player-form");
const playerFormTitle = document.querySelector("#player-form-title");
const playerFormHelp = document.querySelector("#player-form-help");
const emailInput = document.querySelector("#email-input");
const instagramInput = document.querySelector("#instagram-input");
const savePlayerButton = document.querySelector("#save-player-button");
const playerStatus = document.querySelector("#player-status");
const profileCard = document.querySelector("#profile-card");
const profileAvatar = document.querySelector("#profile-avatar");
const profileName = document.querySelector("#profile-name");
const profileMeta = document.querySelector("#profile-meta");
const avatarUpload = document.querySelector("#avatar-upload");
const reminderButton = document.querySelector("#reminder-button");
const reminderStatus = document.querySelector("#reminder-status");
const questionCount = document.querySelector("#question-count");
const scoreText = document.querySelector("#score");
const timerText = document.querySelector("#timer");
const quizPhoto = document.querySelector("#quiz-photo");
const photoCaption = document.querySelector("#photo-caption");
const answers = document.querySelector("#answers");
const finalScore = document.querySelector("#final-score");
const resultMessage = document.querySelector("#results-message");
const historyList = document.querySelector("#history-list");
const historyTableBody = document.querySelector("#history-table-body");
const leaderboardList = document.querySelector("#leaderboard-list");
const championGallery = document.querySelector("#champion-gallery");
const achievementList = document.querySelector("#achievement-list");
const achievementCount = document.querySelector("#achievement-count");
const cheersList = document.querySelector("#cheers-list");
const cheersCount = document.querySelector("#cheers-count");
const referralCard = document.querySelector("#referral-card");
const resultsAchievements = document.querySelector("#results-achievements");

init();

async function init() {
  bindEvents();
  captureReferrer();
  appData = await apiGet("/api/bootstrap");
  activePlayer = await loadActivePlayer();
  syncPlayerView();
  syncReminderState();
  scheduleVoteReminder();
  syncEventWindow();
  attemptGameMusicAutoplay();
  eventWindowTimerId = window.setInterval(syncEventWindow, 1000);
  await renderPageData();
}

function bindEvents() {
  playerForm?.addEventListener("submit", savePlayer);
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });
  document.querySelectorAll("[data-avatar]").forEach((button) => {
    button.addEventListener("click", () => saveAvatar(button.dataset.avatar));
  });
  avatarUpload?.addEventListener("change", saveUploadedAvatar);
  reminderButton?.addEventListener("click", enableVoteReminders);
  audioToggle?.addEventListener("click", toggleGameMusicMute);
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, startGameMusicOnce, { once: true, passive: true });
  });
  startButton?.addEventListener("click", startQuiz);
  restartButton?.addEventListener("click", () => {
    window.location.href = "leaderboard.html";
  });
  aboutLink?.addEventListener("click", (event) => {
    if (!aboutPanel) return;
    event.preventDefault();
    aboutPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function captureReferrer() {
  const referrer = new URLSearchParams(window.location.search).get("ref");
  if (referrer) localStorage.setItem(REFERRER_KEY, referrer.trim().toLowerCase());
}

async function loadActivePlayer() {
  const unix = localStorage.getItem(ACTIVE_UNIX_KEY);
  if (!unix) return null;
  const { player } = await apiGet(`/api/players/${encodeURIComponent(unix)}`);
  return player;
}

async function savePlayer(event) {
  event.preventDefault();
  const email = emailInput.value.trim().toLowerCase();
  const instagram = normalizeInstagram(instagramInput.value);
  const payload = {
    unix: email.split("@")[0],
    email,
    instagram,
    screenName: instagram,
    referredBy: localStorage.getItem(REFERRER_KEY) || "",
  };
  if (activePlayer?.avatar) payload.avatar = activePlayer.avatar;
  if (activePlayer?.avatarImage) payload.avatarImage = activePlayer.avatarImage;

  try {
    setPlayerFormBusy(true);
    const { player, created } = await apiPost("/api/players", payload);
    localStorage.setItem(ACTIVE_UNIX_KEY, player.unix);
    activePlayer = player;
    if (isHomePage() && isAdminProfile(player)) {
      window.location.href = "admin.html";
      return;
    }
    syncPlayerView(created ? "created" : "login");
    await renderPageData();
  } catch (error) {
    playerStatus.textContent = error.message;
  } finally {
    setPlayerFormBusy(false);
  }
}

function isAdminProfile(player) {
  return player.email === ADMIN_EMAIL && normalizeInstagram(player.instagram || player.screenName) === ADMIN_INSTAGRAM;
}

function isHomePage() {
  return window.location.pathname === "/" || window.location.pathname.endsWith("/index.html") || window.location.pathname.endsWith("index.html");
}

function syncPlayerView(mode = "saved") {
  if (!playerForm || !profileCard || !startButton || !playerStatus) return;

  if (!activePlayer) {
    playerForm.classList.remove("hidden");
    profileCard.classList.add("hidden");
    setAuthMode(authMode);
    startButton.disabled = true;
    playerStatus.textContent = "You can only play once, and I hope you have fun.";
    return;
  }

  emailInput.value = activePlayer.email || "";
  instagramInput.value = activePlayer.instagram || activePlayer.screenName || "";
  playerForm.classList.add("hidden");
  profileCard.classList.remove("hidden");
  const actionText = mode === "created" ? "Profile created." : mode === "login" ? "Welcome back." : "Profile saved.";
  playerStatus.textContent = `${actionText} Playing as @${activePlayer.instagram || activePlayer.screenName}. Each photo can only be answered once.`;
  renderProfile();
  syncEventWindow();
}

function setAuthMode(mode) {
  authMode = mode === "login" ? "login" : "signup";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const isActive = button.dataset.authMode === authMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  if (authMode === "login") {
    if (playerFormTitle) playerFormTitle.textContent = "Log in";
    if (playerFormHelp) playerFormHelp.textContent = "Returning player? Enter the same Williams email and exact Instagram username you used before.";
    if (savePlayerButton) savePlayerButton.textContent = "Log In";
    if (playerStatus) playerStatus.textContent = "Your saved answers, score, history, and stickers will load after login.";
    return;
  }

  if (playerFormTitle) playerFormTitle.textContent = "Join the game";
  if (playerFormHelp) playerFormHelp.textContent = "First time playing? Use your Williams email and Instagram username to make your profile.";
  if (savePlayerButton) savePlayerButton.textContent = "Sign Up";
  if (playerStatus) playerStatus.textContent = "You can only play once, and I hope you have fun.";
}

function setPlayerFormBusy(isBusy) {
  if (!savePlayerButton) return;
  savePlayerButton.disabled = isBusy;
  savePlayerButton.textContent = isBusy ? "Checking..." : authMode === "login" ? "Log In" : "Sign Up";
}

function renderProfile() {
  if (!profileAvatar || !profileName || !profileMeta || !activePlayer) return;
  profileAvatar.innerHTML = "";

  if (activePlayer.avatarImage) {
    const image = document.createElement("img");
    image.src = activePlayer.avatarImage;
    image.alt = "";
    profileAvatar.append(image);
  } else {
    profileAvatar.textContent = activePlayer.avatar || "💜";
  }

  profileName.textContent = activePlayer.screenName;
  profileMeta.textContent = `${activePlayer.email} · @${activePlayer.instagram || activePlayer.screenName}`;
}

async function saveAvatar(avatar) {
  if (!activePlayer) return;
  const { player } = await apiPost("/api/players", { ...activePlayer, avatar, avatarImage: null });
  activePlayer = player;
  renderProfile();
}

function saveUploadedAvatar(event) {
  const file = event.target.files?.[0];
  if (!activePlayer || !file) return;

  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    const { player } = await apiPost("/api/players", { ...activePlayer, avatarImage: reader.result });
    activePlayer = player;
    renderProfile();
  });
  reader.readAsDataURL(file);
}

async function startQuiz() {
  const eventState = getEventState();
  if (!activePlayer) {
    playerStatus.textContent = "Sign up or log in first.";
    return;
  }
  if (!activePlayer.verified) {
    playerStatus.textContent = "Sign up or log in with your Williams email and Instagram username before voting.";
    return;
  }
  if (eventState === "early") {
    playerStatus.textContent = `Tournament opens at ${formatDate(appData.settings.eventOpenAt)}.`;
    return;
  }
  if (eventState === "closed") {
    playerStatus.textContent = `Tournament closed at ${formatDate(appData.settings.eventCloseAt)}.`;
    return;
  }

  currentQuestionIndex = 0;
  showScreen(quizScreen);
  await showQuestion();
}

async function showQuestion() {
  const question = appData.questions[currentQuestionIndex];
  const history = await getActiveHistory();
  const existingVote = history.find((vote) => vote.questionId === question.id);
  const secondsPerPhoto = Number(appData.settings.secondsPerPhoto || 10);

  questionCount.textContent = `${currentQuestionIndex + 1} / ${appData.questions.length}`;
  scoreText.textContent = await getActiveScore();
  answers.replaceChildren();
  quizPhoto.src = question.image;
  photoCaption.textContent = getQuestionCaption(question, existingVote);
  clearInterval(timerId);
  questionEndsAt = !existingVote && !question.closed && !question.revealed ? Date.now() + secondsPerPhoto * 1000 : null;

  if (question.kind === "feedback") {
    const textarea = document.createElement("textarea");
    textarea.className = "feedback-input";
    textarea.id = "feedback-input";
    textarea.rows = 4;
    textarea.placeholder = question.commentPrompt || "Add a comment, suggestion, or anything else.";
    textarea.disabled = Boolean(existingVote) || question.closed;
    answers.append(textarea);
  }

  question.options.forEach((option) => {
    const button = document.createElement("button");
    button.className = "answer-button";
    button.type = "button";
    button.textContent = option;
    button.disabled = Boolean(existingVote) || question.closed || question.revealed;

    if (existingVote?.choice === option && !question.revealed) button.classList.add("selected");
    if (question.revealed && question.answer === option) button.classList.add("correct");
    if (question.revealed && existingVote?.choice === option && question.answer !== option) button.classList.add("wrong");

    button.addEventListener("click", () => submitVote(question, option, button));
    answers.append(button);
  });

  updateDeadlineClock(question);
  if (questionEndsAt) {
    timerId = setInterval(() => updateDeadlineClock(question), 250);
  }
}

async function submitVote(question, choice, button) {
  try {
    const feedbackInput = document.querySelector("#feedback-input");
    await apiPost("/api/votes", {
      unix: activePlayer.unix,
      questionId: question.id,
      choice,
      feedbackText: feedbackInput?.value || "",
    });
    clearInterval(timerId);
    questionEndsAt = null;
    button.classList.add("selected");
    [...answers.children].forEach((item) => {
      item.disabled = true;
    });
    photoCaption.textContent = question.kind === "feedback"
      ? "Thanks. Your feedback was saved."
      : `Your answer was saved. The correct location and points unlock after ${formatDate(question.revealAt || question.deadlineAt)}.`;
    setTimeout(nextQuestion, 900);
  } catch (error) {
    photoCaption.textContent = error.message;
  }
}

async function nextQuestion() {
  currentQuestionIndex += 1;
  if (currentQuestionIndex < appData.questions.length) {
    await showQuestion();
  } else {
    await showResults();
  }
}

async function showResults() {
  showScreen(resultsScreen);
  finalScore.textContent = `${await getActiveScore()} points`;
  resultMessage.textContent = `Your selections were saved. Correct answers and points appear after ${formatDate(appData.settings.revealAt)}.`;
  await renderAchievements(resultsAchievements, { unlockedOnly: true, congratulatory: true });
}

function getQuestionCaption(question, existingVote) {
  if (question.revealed && existingVote) {
    return `Revealed: correct answer is ${question.answer}. You chose ${existingVote.choice}.`;
  }
  if (question.kind === "feedback") {
    if (existingVote) return "Thanks. Your feedback was saved.";
    return "Final photo: did you have fun? You have 10 seconds.";
  }
  if (question.revealed) return `Revealed: correct answer is ${question.answer}.`;
  if (existingVote) return `Your answer was saved. The correct location unlocks after ${formatDate(question.revealAt || question.deadlineAt)}.`;
  if (question.closed) return `${question.title}: voting is closed. Solutions release after ${formatDate(question.revealAt || question.deadlineAt)}.`;
  return `${question.title}: choose quickly. You have ${appData.settings.secondsPerPhoto || 10} seconds.`;
}

async function getActiveHistory() {
  if (!activePlayer) return [];
  const { votes } = await apiGet(`/api/history/${encodeURIComponent(activePlayer.unix)}`);
  return votes;
}

async function getActiveScore() {
  return (await getActiveHistory()).reduce((total, vote) => total + vote.points, 0);
}

async function renderPageData() {
  await Promise.all([renderLeaderboard(), renderHistory(), renderPodium(), renderAchievements(achievementList)]);
}

async function renderLeaderboard() {
  if (!leaderboardList) return;
  const { leaders } = await apiGet("/api/leaderboard");

  leaderboardList.innerHTML = leaders
    .map(
      (leader) => {
        const rank = leader.place ?? leader.rank;
        return `
        <tr>
          <td>${escapeHtml(rank)}</td>
          <td>@${escapeHtml(leader.screenName)}</td>
          <td>${escapeHtml(leader.points)}</td>
        </tr>
      `;
      }
    )
    .join("") || `<tr><td colspan="3">Scores will appear here after the reveal.</td></tr>`;
}

async function renderHistory() {
  if (!historyList && !historyTableBody) return;
  const votes = await getActiveHistory();

  if (historyList) {
    historyList.innerHTML = votes.length
      ? votes.map((vote) => `<article class="history-item"><strong>${vote.title}</strong><span>${historyText(vote)}</span><b>${vote.revealed ? `${vote.points} pts` : "Pending"}</b></article>`).join("")
      : "<p>No history yet. Sign up or log in, then make your first guess.</p>";
  }

  if (historyTableBody) {
    historyTableBody.innerHTML = votes.length
      ? votes.map((vote) => `<tr><td>${escapeHtml(vote.title)}</td><td>${escapeHtml(vote.choice)}</td><td>${escapeHtml(vote.correctAnswer || "Hidden until reveal")}</td><td>${escapeHtml(historyResultLabel(vote))}</td><td>${vote.correct ? 10 : 0}</td><td>${vote.correct ? vote.bonusPoints : 0}</td><td>${vote.points}</td><td>${formatDate(vote.answeredAt)}</td></tr>`).join("")
      : `<tr><td colspan="8">No voting history yet. Sign up or log in on the home page, then make your first guess.</td></tr>`;
  }
}

async function renderAchievements(target, options = {}) {
  if (!target) return;
  if (!activePlayer) {
    if (achievementCount) achievementCount.textContent = "Achievements (0/11)";
    if (cheersCount) cheersCount.textContent = "Cheers (0/2)";
    target.innerHTML = `<p class="achievement-empty">Sign up or log in on the home page to start unlocking stickers.</p>`;
    return;
  }
  const achievementPayload = await apiGet(`/api/achievements/${encodeURIComponent(activePlayer.unix)}`);
  const achievements = achievementPayload.achievements;
  const cheers = achievementPayload.cheers || [];
  const visibleAchievements = options.unlockedOnly
    ? achievements.filter((achievement) => achievement.unlocked)
    : achievements;
  const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;

  if (achievementCount) {
    achievementCount.textContent = `Achievements (${unlockedCount}/${achievements.length})`;
  }

  target.innerHTML = visibleAchievements.length
    ? visibleAchievements.map((achievement) => `
        <article class="achievement-card ${achievement.unlocked ? "unlocked" : "locked"}">
          <span>${escapeHtml(achievement.sticker)}</span>
          <strong>${options.congratulatory && achievement.unlocked ? "Congratulations! " : ""}${escapeHtml(achievement.title)}</strong>
          <em>${escapeHtml(achievement.description)}</em>
        </article>
      `).join("")
    : "";

  renderCheers(cheers);
  renderReferralCard();
}

function renderCheers(cheers) {
  if (!cheersList) return;
  const unlockedCount = cheers.filter((item) => item.unlocked).length;
  if (cheersCount) cheersCount.textContent = `Cheers (${unlockedCount}/${cheers.length})`;
  cheersList.innerHTML = cheers.map((item) => `
    <article class="achievement-card cheers-card ${item.unlocked ? "unlocked" : "locked"}">
      <span>${escapeHtml(item.sticker)}${item.count ? `<b>${escapeHtml(item.count)}</b>` : ""}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <em>${escapeHtml(item.description)}</em>
    </article>
  `).join("");
}

function renderReferralCard() {
  if (!referralCard || !activePlayer) return;
  const url = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "index.html")}?ref=${encodeURIComponent(activePlayer.unix)}`;
  const message = `Join me on Where Is This Williams: ${url}`;
  const encodedUrl = encodeURIComponent(url);
  const encodedMessage = encodeURIComponent(message);
  referralCard.innerHTML = `
    <strong>Your referral link</strong>
    <span>${escapeHtml(url)}</span>
    <div class="referral-actions" aria-label="Share your referral link">
      <a class="share-button" href="mailto:?subject=Where%20Is%20This%20Williams&body=${encodedMessage}" title="Email" aria-label="Share by email"><span aria-hidden="true">✉</span></a>
      <a class="share-button" href="https://wa.me/?text=${encodedMessage}" target="_blank" rel="noopener" title="WhatsApp" aria-label="Share on WhatsApp">${shareIcon("web.whatsapp.com", "WhatsApp")}</a>
      <a class="share-button" href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" target="_blank" rel="noopener" title="Facebook" aria-label="Share on Facebook">${shareIcon("facebook.com", "Facebook")}</a>
      <a class="share-button" href="https://twitter.com/intent/tweet?text=${encodedMessage}" target="_blank" rel="noopener" title="Twitter/X" aria-label="Share on Twitter or X">${shareIcon("x.com", "Twitter/X")}</a>
      <a class="share-button" href="https://groupme.com/share?text=${encodedMessage}" target="_blank" rel="noopener" title="GroupMe" aria-label="Share on GroupMe">${shareIcon("groupme.com", "GroupMe")}</a>
      <button class="share-button" type="button" data-copy-share="Snapchat" title="Snapchat" aria-label="Copy link for Snapchat">${shareIcon("snapchat.com", "Snapchat")}</button>
      <button class="share-button" type="button" data-copy-share="Instagram" title="Instagram" aria-label="Copy link for Instagram">${shareIcon("instagram.com", "Instagram")}</button>
      <a class="share-button" href="sms:?body=${encodedMessage}" title="Messages" aria-label="Share by text message"><span aria-hidden="true">💬</span></a>
    </div>
    <small id="referral-share-status">Share your link so friends can join from your invite.</small>
  `;
  bindReferralShareButtons(url);
}

function shareIcon(domain, label) {
  return `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" alt="" aria-hidden="true" /><span class="visually-hidden">${escapeHtml(label)}</span>`;
}

function bindReferralShareButtons(url) {
  referralCard.querySelectorAll("[data-copy-share]").forEach((button) => {
    button.addEventListener("click", async () => {
      await copyReferralLink(url);
      setReferralShareStatus(`Link copied. Paste it into ${button.dataset.copyShare}.`);
    });
  });
}

async function copyReferralLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    setReferralShareStatus("Referral link copied.");
  } catch {
    setReferralShareStatus("Copy failed. Press and hold the link above to copy it.");
  }
}

function setReferralShareStatus(message) {
  const status = document.querySelector("#referral-share-status");
  if (status) status.textContent = message;
}

async function renderPodium() {
  if (!championGallery) return;
  const { terms } = await apiGet("/api/podium");
  if (!terms.length) {
    championGallery.innerHTML = `
      <section class="empty-podium">
        <strong>Final winners have not been released yet.</strong>
        <p>The Podium of Champions will show first, second, and third place only after the competition is finalized.</p>
      </section>
    `;
    return;
  }

  championGallery.innerHTML = terms
    .map((term) => {
      const winners = [...term.winners].sort((a, b) => ({ 2: 1, 1: 2, 3: 3 })[a.place] - ({ 2: 1, 1: 2, 3: 3 })[b.place]);
      return `<section class="term-podium"><h2>${term.term}</h2><div class="winner-grid olympic-podium">${winners.map((winner) => `<article class="winner-card place-${winner.place}"><img src="${winner.image}" alt="${winner.screenName}" /><div><span>${winner.place}</span><strong>${winner.screenName}</strong><em>${winner.points} pts</em></div></article>`).join("")}</div></section>`;
    })
    .join("");
}

function historyText(vote) {
  if (!vote.revealed) return `Picked: ${vote.choice}. Answer hidden until the reveal.`;
  if (vote.correct) return `${vote.choice} was guessed right.`;
  return `${historyResultLabel(vote)}: answer was ${vote.correctAnswer}.`;
}

function historyResultLabel(vote) {
  if (!vote.revealed) return "Pending reveal";
  if (vote.correct) return "Guessed right";
  return vote.bonusPoints > 0 ? "Almost" : "Nice try";
}

function showScreen(screenToShow) {
  introScreen.classList.add("hidden");
  quizScreen.classList.add("hidden");
  resultsScreen.classList.add("hidden");
  screenToShow.classList.remove("hidden");
}

function syncEventWindow() {
  if (!startButton || !playerStatus) return;
  const eventState = getEventState();

  if (!activePlayer) {
    startButton.disabled = true;
    startButton.querySelector("strong").textContent = "Start";
    return;
  }

  if (eventState === "early") {
    startButton.disabled = true;
    startButton.querySelector("strong").textContent = "Opens Soon";
    playerStatus.textContent = `Playing as @${activePlayer.instagram || activePlayer.screenName}. Tournament opens in ${formatCountdown(appData.settings.eventOpenAt)}.`;
    return;
  }

  if (eventState === "closed") {
    startButton.disabled = true;
    startButton.querySelector("strong").textContent = "Closed";
    playerStatus.textContent = `Tournament closed at ${formatDate(appData.settings.eventCloseAt)}.`;
    return;
  }

  startButton.disabled = false;
  startButton.querySelector("strong").textContent = "Start";
  playerStatus.textContent = `Playing as @${activePlayer.instagram || activePlayer.screenName}. Each photo can only be answered once.`;
}

async function enableVoteReminders() {
  if (!("Notification" in window)) {
    reminderStatus.textContent = "This browser does not support reminders.";
    return;
  }
  const permission = await Notification.requestPermission();
  localStorage.setItem(REMINDERS_KEY, permission === "granted" ? "yes" : "no");
  syncReminderState();
  scheduleVoteReminder();
  if (permission === "granted") {
    new Notification("Where Is This Williams", { body: `Reminder is on for ${formatDate(getReminderAt())}.` });
  }
}

function startGameMusicOnce() {
  if (!music) music = createGameMusic();
  music.start();
  syncAudioToggle();
}

function attemptGameMusicAutoplay() {
  if (!music) music = createGameMusic();
  music.start();
  syncAudioToggle();
}

function toggleGameMusicMute() {
  if (!music) music = createGameMusic();
  music.start();
  music.setMuted(!music.isMuted());
  syncAudioToggle();
}

function syncAudioToggle() {
  if (!audioToggle || !music) return;
  audioToggle.textContent = music.isMuted() ? "Unmute" : "Mute";
  audioToggle.setAttribute("aria-pressed", String(music.isMuted()));
}

function createGameMusic() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return {
      isPlaying: () => false,
      isMuted: () => true,
      setMuted: () => {},
      start: () => {
        if (audioToggle) audioToggle.textContent = "No Audio";
      },
      stop: () => {},
    };
  }

  const audio = new AudioContext();
  const stepDuration = 300;
  const loopSteps = 16;
  let beatTimer = null;
  let lastPlayedStep = -1;
  let muted = localStorage.getItem(AUDIO_MUTED_KEY) === "yes";

  function start() {
    if (beatTimer) return;
    ensureMusicClock();
    audio.resume().catch(() => {});
    playStep();
    beatTimer = window.setInterval(playStep, 75);
  }

  function stop() {
    if (!beatTimer) return;
    window.clearInterval(beatTimer);
    beatTimer = null;
  }

  function isPlaying() {
    return Boolean(beatTimer);
  }

  function isMuted() {
    return muted;
  }

  function setMuted(value) {
    muted = Boolean(value);
    localStorage.setItem(AUDIO_MUTED_KEY, muted ? "yes" : "no");
  }

  function playStep() {
    const step = getCurrentStep();
    if (step === lastPlayedStep) return;
    lastPlayedStep = step;

    if (muted) {
      return;
    }

    const now = audio.currentTime;
    if (step % 4 === 0) playDrum(now, 110, 0.18, 0.22);
    if (step % 4 === 2) playDrum(now, 170, 0.08, 0.12);
    if (step % 2 === 1) playTick(now);
    if (step % 8 === 0) playTone(now, 392, 0.28);
    if (step % 8 === 4) playTone(now, 523.25, 0.22);
  }

  function ensureMusicClock() {
    const startedAt = Number(localStorage.getItem(MUSIC_STARTED_AT_KEY));
    if (!startedAt || !Number.isFinite(startedAt)) {
      localStorage.setItem(MUSIC_STARTED_AT_KEY, String(Date.now()));
    }
  }

  function getCurrentStep() {
    ensureMusicClock();
    const startedAt = Number(localStorage.getItem(MUSIC_STARTED_AT_KEY));
    const elapsed = Math.max(0, Date.now() - startedAt);
    return Math.floor(elapsed / stepDuration) % loopSteps;
  }

  function playDrum(time, frequency, duration, volume) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(45, time + duration);
    oscillator.type = "sine";
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(time);
    oscillator.stop(time + duration);
  }

  function playTick(time) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 1320;
    oscillator.type = "triangle";
    gain.gain.setValueAtTime(0.035, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.05);
  }

  function playTone(time, frequency, duration) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.055, time + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(time);
    oscillator.stop(time + duration);
  }

  return { isPlaying, isMuted, setMuted, start, stop };
}

function syncReminderState() {
  if (!reminderButton || !reminderStatus) return;
  if (!("Notification" in window)) {
    reminderButton.disabled = true;
    reminderStatus.textContent = "Browser reminders are not supported here.";
    return;
  }
  if (localStorage.getItem(REMINDERS_KEY) === "yes" && Notification.permission === "granted") {
    reminderButton.textContent = "Vote Reminders Enabled";
    reminderButton.disabled = true;
    reminderStatus.textContent = `Reminder saved for ${formatDate(getReminderAt())}. Keep this tab open for the chime.`;
    return;
  }
  reminderButton.textContent = "Enable Vote Reminders";
  reminderButton.disabled = false;
  reminderStatus.textContent = `Get a browser reminder 15 minutes before the ${formatDate(appData.settings.eventOpenAt)} start.`;
}

function scheduleVoteReminder() {
  if (localStorage.getItem(REMINDERS_KEY) !== "yes" || !("Notification" in window) || Notification.permission !== "granted") return;
  const reminderAt = getReminderAt();
  const delay = reminderAt.getTime() - Date.now();
  if (delay <= 0) return;
  window.setTimeout(() => {
    playReminderChime();
    new Notification("Where Is This Williams starts soon", { body: "The tournament opens in 15 minutes. Keep this tab ready for 6:30 PM." });
  }, Math.min(delay, 2147483647));
}

function updateDeadlineClock(question) {
  if (!timerText) return;
  if (questionEndsAt) {
    const remaining = questionEndsAt - Date.now();
    if (remaining <= 0) {
      questionEndsAt = null;
      window.clearInterval(timerId);
      timerText.textContent = "Time";
      [...answers.children].forEach((item) => {
        item.disabled = true;
      });
      photoCaption.textContent = question.kind === "feedback"
        ? "Time is up. Thanks for playing."
        : "Time is up. Moving to the next photo.";
      setTimeout(nextQuestion, 700);
      return;
    }
    timerText.textContent = `${Math.ceil(remaining / 1000)}s`;
    return;
  }

  const remaining = new Date(question.deadlineAt).getTime() - Date.now();
  if (remaining <= 0) {
    timerText.textContent = question.revealed ? "Revealed" : "Closed";
    return;
  }
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  timerText.textContent = `${hours}h ${minutes}m ${seconds}s`;
}

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatCountdown(value) {
  const remaining = Math.max(0, new Date(value).getTime() - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

function getEventState() {
  const now = Date.now();
  const openAt = new Date(appData.settings.eventOpenAt || 0).getTime();
  const closeAt = new Date(appData.settings.eventCloseAt || Number.POSITIVE_INFINITY).getTime();
  if (openAt && now < openAt) return "early";
  if (closeAt && now >= closeAt) return "closed";
  return "open";
}

function getReminderAt() {
  if (appData.settings.reminderAt) return new Date(appData.settings.reminderAt);
  return new Date(new Date(appData.settings.eventOpenAt).getTime() - 15 * 60 * 1000);
}

function playReminderChime() {
  if (localStorage.getItem(AUDIO_MUTED_KEY) === "yes") return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const audio = new AudioContext();
  [0, 0.18, 0.36].forEach((offset) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.001, audio.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.22, audio.currentTime + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + offset + 0.14);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(audio.currentTime + offset);
    oscillator.stop(audio.currentTime + offset + 0.16);
  });
}

async function apiGet(path) {
  const response = await fetch(path);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function normalizeInstagram(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
