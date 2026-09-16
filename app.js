const ACTIVE_UNIX_KEY = "where-is-this-williams-active-unix";
const AUTH_TOKEN_KEY = "where-is-this-williams-auth-token";
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
let autoAdvanceTimerId = null;
let eventWindowTimerId = null;
let music = null;
let questionEndsAt = null;
let authMode = "signup";
let authSubmitButton = null;
let profileCompletionMode = false;

const introScreen = document.querySelector("#intro-screen");
const quizScreen = document.querySelector("#quiz-screen");
const resultsScreen = document.querySelector("#results-screen");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const audioToggle = document.querySelector("#audio-toggle");
const logoutButtons = document.querySelectorAll("[data-logout-button]");
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
const photoPointsText = document.querySelector("#photo-points");
const quizPhoto = document.querySelector("#quiz-photo");
const photoCaption = document.querySelector("#photo-caption");
const answers = document.querySelector("#answers");
const nextQuestionButton = document.querySelector("#next-question-button");
const finalScore = document.querySelector("#final-score");
const resultMessage = document.querySelector("#results-message");
const historyList = document.querySelector("#history-list");
const historyTableBody = document.querySelector("#history-table-body");
const leaderboardList = document.querySelector("#leaderboard-list");
const postsGrid = document.querySelector("#posts-grid");
const postsSubmitButton = document.querySelector("#posts-submit-button");
const postsSubmitStatus = document.querySelector("#posts-submit-status");
const championGallery = document.querySelector("#champion-gallery");
const achievementList = document.querySelector("#achievement-list");
const achievementCount = document.querySelector("#achievement-count");
const cheersList = document.querySelector("#cheers-list");
const cheersCount = document.querySelector("#cheers-count");
const referralCard = document.querySelector("#referral-card");
const resultsAchievements = document.querySelector("#results-achievements");

init();

async function init() {
  authMode = getDefaultAuthMode();
  bindEvents();
  captureReferrer();
  const verifiedSession = await completeEmailLoginFromHash();
  appData = await apiGet("/api/bootstrap");
  activePlayer = verifiedSession?.player || await loadActivePlayer();
  if (verifiedSession?.player) localStorage.setItem(ACTIVE_UNIX_KEY, verifiedSession.player.unix);
  if (isLoginPage() && verifiedSession?.needsProfile) {
    document.body.classList.remove("auth-pending");
    showProfileCompletion(verifiedSession.player);
    return;
  }
  if (document.body.classList.contains("requires-player") && !activePlayer) {
    redirectToLogin();
    return;
  }
  if (isLoginPage() && activePlayer) {
    if (!hasDisplayProfile(activePlayer)) {
      document.body.classList.remove("auth-pending");
      showProfileCompletion(activePlayer);
      return;
    }
    redirectAfterLogin(activePlayer);
    return;
  }
  document.body.classList.remove("auth-pending");
  syncPlayerView();
  syncReminderState();
  scheduleVoteReminder();
  syncEventWindow();
  if (!isLoginPage()) attemptGameMusicAutoplay();
  eventWindowTimerId = window.setInterval(syncEventWindow, 1000);
  await renderPageData();
}

function bindEvents() {
  playerForm?.addEventListener("submit", savePlayer);
  document.querySelectorAll("[data-submit-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      authMode = button.dataset.submitMode === "login" ? "login" : "signup";
      authSubmitButton = button;
    });
  });
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });
  document.querySelectorAll("[data-avatar]").forEach((button) => {
    button.addEventListener("click", () => saveAvatar(button.dataset.avatar));
  });
  avatarUpload?.addEventListener("change", saveUploadedAvatar);
  reminderButton?.addEventListener("click", enableVoteReminders);
  audioToggle?.addEventListener("click", toggleGameMusicMute);
  logoutButtons.forEach((button) => button.addEventListener("click", logoutPlayer));
  postsGrid?.addEventListener("click", selectPostOption);
  postsSubmitButton?.addEventListener("click", submitPostSelections);
  achievementList?.addEventListener("click", showAchievementDetail);
  achievementList?.addEventListener("keydown", openAchievementDetailFromKeyboard);
  cheersList?.addEventListener("click", showAchievementDetail);
  cheersList?.addEventListener("keydown", openAchievementDetailFromKeyboard);
  if (!isLoginPage()) {
    ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
      window.addEventListener(eventName, startGameMusicOnce, { once: true, passive: true });
    });
  }
  startButton?.addEventListener("click", startQuiz);
  nextQuestionButton?.addEventListener("click", nextQuestion);
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
  if (!player) localStorage.removeItem(ACTIVE_UNIX_KEY);
  return player;
}

async function savePlayer(event) {
  event.preventDefault();
  if (profileCompletionMode) {
    await saveVerifiedProfile();
    return;
  }

  const email = emailInput.value.trim().toLowerCase();

  try {
    setPlayerFormBusy(true);
    await apiPost("/api/auth/send-link", {
      email,
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    });
    playerStatus.textContent = "Check your Williams email to continue.";
  } catch (error) {
    playerStatus.textContent = error.message;
  } finally {
    setPlayerFormBusy(false);
  }
}

async function completeEmailLoginFromHash() {
  if (!isLoginPage()) return null;
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const searchParams = new URLSearchParams(window.location.search);
  const accessToken = hashParams.get("access_token");
  const code = searchParams.get("code");
  if (!accessToken && !code) return null;

  if (accessToken) localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
  searchParams.delete("code");
  const cleanSearch = searchParams.toString();
  window.history.replaceState({}, document.title, `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}`);

  try {
    const session = await apiPost("/api/auth/session", {
      accessToken,
      code,
      referredBy: localStorage.getItem(REFERRER_KEY) || "",
    });
    if (session.accessToken) localStorage.setItem(AUTH_TOKEN_KEY, session.accessToken);
    localStorage.setItem(ACTIVE_UNIX_KEY, session.player.unix);
    return session;
  } catch (error) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    if (playerStatus) playerStatus.textContent = error.message;
    return null;
  }
}

function showProfileCompletion(player) {
  profileCompletionMode = true;
  activePlayer = player;
  localStorage.setItem(ACTIVE_UNIX_KEY, player.unix);
  if (emailInput) {
    emailInput.value = player.email || "";
    emailInput.disabled = true;
  }
  if (instagramInput) {
    instagramInput.required = true;
    instagramInput.closest("label")?.classList.remove("hidden");
    instagramInput.focus();
  }
  document.querySelectorAll("[data-submit-mode]").forEach((button) => {
    button.classList.toggle("hidden", button !== savePlayerButton);
  });
  if (savePlayerButton) savePlayerButton.textContent = "Save Instagram";
  if (playerStatus) playerStatus.textContent = "Add the Instagram username people will see on the leaderboard.";
}

async function saveVerifiedProfile() {
  const instagram = normalizeInstagram(instagramInput.value);
  try {
    setPlayerFormBusy(true);
    const { player } = await apiPost("/api/auth/profile", {
      instagram,
      referredBy: localStorage.getItem(REFERRER_KEY) || "",
    });
    localStorage.setItem(ACTIVE_UNIX_KEY, player.unix);
    activePlayer = player;
    redirectAfterLogin(player);
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

function isLoginPage() {
  return window.location.pathname.endsWith("/login.html") || window.location.pathname.endsWith("login.html");
}

function getDefaultAuthMode() {
  if (!isLoginPage()) return "signup";
  return new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "login";
}

function redirectToLogin() {
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.href = `login.html?next=${encodeURIComponent(next)}`;
}

function redirectAfterLogin(player) {
  window.location.href = "achievements.html";
}

function logoutPlayer() {
  localStorage.removeItem(ACTIVE_UNIX_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem("where-is-this-williams-admin-token");
  activePlayer = null;
  window.location.href = "login.html";
}

function syncPlayerView(mode = "saved") {
  if (!playerForm || !playerStatus) return;

  if (!activePlayer) {
    playerForm.classList.remove("hidden");
    profileCard?.classList.add("hidden");
    setAuthMode(authMode);
    if (instagramInput && isLoginPage()) {
      instagramInput.required = false;
      instagramInput.closest("label")?.classList.add("hidden");
    }
    if (startButton) startButton.disabled = true;
    if (!isLoginPage()) playerStatus.textContent = "You can only play once, and I hope you have fun.";
    return;
  }

  if (emailInput) emailInput.value = activePlayer.email || "";
  if (instagramInput) instagramInput.value = activePlayer.instagram || activePlayer.screenName || "";
  playerForm.classList.add("hidden");
  profileCard?.classList.remove("hidden");
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

  if (isLoginPage() && !document.querySelector("[data-auth-mode]")) {
    if (playerStatus) playerStatus.textContent = "";
    if (savePlayerButton) savePlayerButton.textContent = "Continue";
    return;
  }

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
  document.querySelectorAll("[data-submit-mode]").forEach((button) => {
    button.disabled = isBusy;
  });
  if (isLoginPage()) {
    const activeButton = authSubmitButton || savePlayerButton;
    activeButton.textContent = isBusy ? "Checking..." : profileCompletionMode ? "Save Instagram" : "Continue";
    return;
  }
  savePlayerButton.textContent = isBusy ? "Checking..." : authMode === "login" ? "Log In" : "Sign Up";
}

function hasDisplayProfile(player) {
  return Boolean(normalizeInstagram(player?.instagram || player?.screenName));
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
  if (photoPointsText) photoPointsText.textContent = `${getQuestionPoints(question)} points`;
  answers.replaceChildren();
  hideNextQuestionButton();
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

  if (existingVote || question.closed || question.revealed) showNextQuestionButton();

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
    [...answers.children].forEach((item) => {
      if (item.classList?.contains("answer-button")) item.classList.remove("selected");
    });
    button.classList.add("selected");
    [...answers.children].forEach((item) => {
      item.disabled = true;
    });
    photoCaption.textContent = question.kind === "feedback"
      ? "Thanks. Your feedback was saved."
      : `Your answer was saved. The correct location and points unlock after ${formatDate(question.revealAt || question.deadlineAt)}.`;
    showNextQuestionButton({ autoAdvance: true });
  } catch (error) {
    photoCaption.textContent = error.message;
  }
}

function showNextQuestionButton({ autoAdvance = false } = {}) {
  if (!nextQuestionButton) return;
  const isLastQuestion = currentQuestionIndex >= appData.questions.length - 1;
  nextQuestionButton.textContent = isLastQuestion ? "See Results" : "Next Photo";
  nextQuestionButton.classList.remove("hidden");
  if (autoAdvance) {
    clearAutoAdvanceTimer();
    autoAdvanceTimerId = window.setTimeout(nextQuestion, Number(appData.settings.secondsPerPhoto || 10) * 1000);
  }
}

function hideNextQuestionButton() {
  nextQuestionButton?.classList.add("hidden");
  clearAutoAdvanceTimer();
}

function clearAutoAdvanceTimer() {
  if (!autoAdvanceTimerId) return;
  window.clearTimeout(autoAdvanceTimerId);
  autoAdvanceTimerId = null;
}

async function nextQuestion() {
  clearAutoAdvanceTimer();
  currentQuestionIndex += 1;
  if (currentQuestionIndex < appData.questions.length) {
    await showQuestion();
  } else {
    await showResults();
  }
}

async function showResults() {
  showScreen(resultsScreen);
  finalScore.textContent = "Results ready at 9:30 PM";
  resultMessage.textContent = "Your selections were saved. Correct answers, points, and leaderboard updates will be ready at 9:30 PM.";
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

function getQuestionPoints(question) {
  if (question.kind === "feedback") return 0;
  return Number(appData.settings.basePoints || 10) + Number(question.bonusPoints || 0);
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
  await Promise.all([renderLeaderboard(), renderHistory(), renderPosts(), renderPodium(), renderAchievements(achievementList)]);
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
      ? votes.map((vote) => `<tr><td>${escapeHtml(vote.title)}</td><td>${escapeHtml(vote.choice)}</td><td>${escapeHtml(vote.correctAnswer || "Hidden until reveal")}</td><td>${vote.points}</td><td>${formatDate(vote.answeredAt)}</td></tr>`).join("")
      : `<tr><td colspan="5">No voting history yet.</td></tr>`;
  }
}

async function renderPosts() {
  if (!postsGrid) return;
  const savedSubmission = localStorage.getItem("where-is-this-williams-post-submissions");
  if (savedSubmission) {
    showPostsSubmittedMessage();
    return;
  }
  const questions = appData.questions;
  postsGrid.innerHTML = questions.length
    ? questions.map((question, index) => `
        <article class="post-card" data-post-id="${escapeHtml(question.id)}">
          <img src="${escapeHtml(question.image)}" alt="${escapeHtml(question.title)}" />
          <div class="post-card-body">
            <div class="post-card-topline">
              <strong>${question.kind === "feedback" ? "Feedback" : `${getQuestionPoints(question)} pts`}</strong>
            </div>
            ${question.kind === "feedback" ? "" : `
              <div class="post-options">
                ${question.options.map((option) => `<button type="button" data-post-option>${escapeHtml(option)}</button>`).join("")}
              </div>
            `}
            ${question.kind === "feedback" ? `
              <label class="post-comment-label">
                Suggestions
                <textarea data-post-comment rows="4" placeholder="${escapeHtml(question.commentPrompt || "Add a comment, suggestion, or anything else.")}"></textarea>
              </label>
            ` : ""}
          </div>
        </article>
      `).join("")
    : `<p class="page-copy">No posts yet.</p>`;
}

function selectPostOption(event) {
  const button = event.target.closest("[data-post-option]");
  if (!button) return;
  const options = button.closest(".post-options");
  if (!options) return;
  options.querySelectorAll("[data-post-option]").forEach((optionButton) => {
    optionButton.classList.toggle("selected", optionButton === button);
  });
}

async function submitPostSelections() {
  if (!postsGrid || !postsSubmitStatus) return;
  const cards = [...postsGrid.querySelectorAll(".post-card")];
  const selections = cards.map((card) => {
    const selected = card.querySelector("[data-post-option].selected");
    return {
      postId: card.dataset.postId,
      choice: selected?.textContent.trim() || "",
      comment: card.querySelector("[data-post-comment]")?.value || "",
    };
  });

  try {
    if (!activePlayer) throw new Error("Log in before submitting.");
    if (postsSubmitButton) postsSubmitButton.disabled = true;
    postsSubmitStatus.textContent = "Submitting...";
    await apiPost("/api/post-submissions", {
      unix: activePlayer.unix,
      selections,
    });
    localStorage.setItem("where-is-this-williams-post-submissions", JSON.stringify({
      selections,
      savedAt: new Date().toISOString(),
    }));
    showPostsSubmittedMessage();
  } catch (error) {
    if (postsSubmitButton) postsSubmitButton.disabled = false;
    postsSubmitStatus.textContent = error.message;
  }
}

function showPostsSubmittedMessage() {
  if (!postsGrid) return;
  postsGrid.innerHTML = `<section class="posts-submitted-message"><strong>Submitted.</strong><span>Thank you for participating.</span></section>`;
  if (postsSubmitButton) postsSubmitButton.classList.add("hidden");
  postsSubmitStatus.textContent = "";
}

async function renderAchievements(target, options = {}) {
  if (!target) return;
  if (!activePlayer) {
    if (achievementCount) achievementCount.textContent = "Achievements";
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
        <article class="achievement-card ${achievement.unlocked ? "unlocked" : "locked"}" tabindex="0" role="button" data-achievement-title="${escapeHtml(achievement.title)}" data-achievement-description="${escapeHtml(achievement.description)}" data-achievement-state="${achievement.unlocked ? "Unlocked" : "Locked"}">
          <span>${escapeHtml(achievement.sticker)}</span>
          <strong>${options.congratulatory && achievement.unlocked ? "Congratulations! " : ""}${escapeHtml(achievement.title)}</strong>
          <em>${escapeHtml(achievement.description)}</em>
        </article>
      `).join("")
    : "";

  renderCheers(cheers);
  renderReferralCard();
  celebrateJoiningAchievement(achievements);
}

function renderCheers(cheers) {
  if (!cheersList) return;
  const unlockedCount = cheers.filter((item) => item.unlocked).length;
  if (cheersCount) cheersCount.textContent = `Cheers (${unlockedCount}/${cheers.length})`;
  cheersList.innerHTML = cheers.map((item) => `
    <article class="achievement-card cheers-card ${item.unlocked ? "unlocked" : "locked"}" tabindex="0" role="button" data-achievement-title="${escapeHtml(item.title)}" data-achievement-description="${escapeHtml(item.description)}" data-achievement-state="${item.unlocked ? "Unlocked" : "Locked"}">
      <span>${escapeHtml(item.sticker)}${item.count ? `<b>${escapeHtml(item.count)}</b>` : ""}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <em>${escapeHtml(item.description)}</em>
    </article>
  `).join("");
}

function showAchievementDetail(event) {
  const card = event.target.closest(".achievement-card");
  if (!card) return;

  document.querySelector(".achievement-detail")?.remove();
  const detail = document.createElement("aside");
  detail.className = "achievement-detail";
  detail.innerHTML = `
    <button type="button" aria-label="Close achievement details">×</button>
    <small>${escapeHtml(card.dataset.achievementState || "")}</small>
    <strong>${escapeHtml(card.dataset.achievementTitle || "")}</strong>
    <p>${escapeHtml(card.dataset.achievementDescription || "")}</p>
  `;
  detail.querySelector("button").addEventListener("click", () => detail.remove());
  document.body.append(detail);
  window.setTimeout(() => detail.classList.add("visible"), 10);
  window.setTimeout(() => detail.remove(), 5200);
}

function openAchievementDetailFromKeyboard(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!event.target.closest(".achievement-card")) return;
  event.preventDefault();
  showAchievementDetail(event);
}

function celebrateJoiningAchievement(achievements) {
  if (!activePlayer || !achievementList) return;
  const joined = achievements.find((achievement) => achievement.id === "joined" && achievement.unlocked);
  if (!joined) return;

  const celebrationKey = `where-is-this-williams-joined-celebrated-${activePlayer.unix}`;
  if (localStorage.getItem(celebrationKey)) return;
  localStorage.setItem(celebrationKey, "true");

  const card = achievementList.querySelector('[data-achievement-title="Joined the Map"]');
  card?.classList.add("fresh-unlock");

  const toast = document.createElement("section");
  toast.className = "achievement-celebration";
  toast.innerHTML = `
    <span aria-hidden="true">💜</span>
    <strong>Achievement unlocked</strong>
    <p>Joined the Map</p>
  `;
  document.body.append(toast);
  window.setTimeout(() => toast.classList.add("visible"), 10);
  window.setTimeout(() => {
    toast.classList.remove("visible");
    window.setTimeout(() => toast.remove(), 500);
  }, 3600);
}

function renderReferralCard() {
  if (!referralCard || !activePlayer) return;
  const url = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "index.html")}?ref=${encodeURIComponent(activePlayer.unix)}`;
  const message = `Join me on Where Is This Williams: ${url}`;
  const encodedUrl = encodeURIComponent(url);
  const encodedMessage = encodeURIComponent(message);
  referralCard.innerHTML = `
    <strong>Your referral link</strong>
    <div class="referral-link-row">
      <span>${escapeHtml(url)}</span>
      <button class="copy-referral-button" type="button" data-copy-share="Copy" title="Copy referral link" aria-label="Copy referral link">🔗</button>
    </div>
    <div class="referral-actions" aria-label="Share your referral link">
      <a class="share-button" href="mailto:?subject=Where%20Is%20This%20Williams&body=${encodedMessage}" title="Email" aria-label="Share by email"><span aria-hidden="true">✉</span></a>
      <a class="share-button whatsapp-share" href="https://wa.me/?text=${encodedMessage}" target="_blank" rel="noopener" title="WhatsApp" aria-label="Share on WhatsApp"><span aria-hidden="true">☎</span></a>
      <a class="share-button" href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" target="_blank" rel="noopener" title="Facebook" aria-label="Share on Facebook">${shareIcon("facebook.com", "Facebook")}</a>
      <a class="share-button" href="https://twitter.com/intent/tweet?text=${encodedMessage}" target="_blank" rel="noopener" title="Twitter/X" aria-label="Share on Twitter or X">${shareIcon("x.com", "Twitter/X")}</a>
      <a class="share-button" href="https://groupme.com/share?text=${encodedMessage}" target="_blank" rel="noopener" title="GroupMe" aria-label="Share on GroupMe">${shareIcon("groupme.com", "GroupMe")}</a>
      <button class="share-button" type="button" data-copy-share="Snapchat" title="Snapchat" aria-label="Copy link for Snapchat">${shareIcon("snapchat.com", "Snapchat")}</button>
      <button class="share-button" type="button" data-copy-share="Instagram" title="Instagram" aria-label="Copy link for Instagram">${shareIcon("instagram.com", "Instagram")}</button>
      <a class="share-button" href="sms:?body=${encodedMessage}" title="Messages" aria-label="Share by text message"><span aria-hidden="true">💬</span></a>
    </div>
    <small id="referral-share-status" aria-live="polite"></small>
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
      const target = button.dataset.copyShare;
      setReferralShareStatus(target === "Copy" ? "Referral link copied." : `Referral link copied for ${target}.`);
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
    championGallery.innerHTML = "";
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
  const isMuted = music.isMuted();
  audioToggle.textContent = isMuted ? "🔇" : "🔊";
  audioToggle.setAttribute("aria-label", isMuted ? "Unmute audio" : "Mute audio");
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
      showNextQuestionButton();
      autoAdvanceTimerId = window.setTimeout(nextQuestion, 700);
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
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function authHeaders(base = {}) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
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
