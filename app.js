const ACTIVE_UNIX_KEY = "where-is-this-williams-active-unix";
const REMINDERS_KEY = "where-is-this-williams-reminders";

let appData = { settings: {}, questions: [] };
let activePlayer = null;
let currentQuestionIndex = 0;
let timerId = null;
let resendTimerId = null;

const introScreen = document.querySelector("#intro-screen");
const quizScreen = document.querySelector("#quiz-screen");
const resultsScreen = document.querySelector("#results-screen");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const aboutLink = document.querySelector('a[href="#about"]');
const aboutPanel = document.querySelector("#about");
const playerForm = document.querySelector("#player-form");
const unixInput = document.querySelector("#unix-input");
const emailInput = document.querySelector("#email-input");
const realNameInput = document.querySelector("#real-name-input");
const screenNameInput = document.querySelector("#screen-name-input");
const playerStatus = document.querySelector("#player-status");
const verifyForm = document.querySelector("#verify-form");
const verifyCodeInput = document.querySelector("#verify-code-input");
const verifyStatus = document.querySelector("#verify-status");
const resendCodeButton = document.querySelector("#resend-code-button");
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

init();

async function init() {
  bindEvents();
  appData = await apiGet("/api/bootstrap");
  activePlayer = await loadActivePlayer();
  syncPlayerView();
  syncReminderState();
  scheduleVoteReminder();
  await renderPageData();
}

function bindEvents() {
  playerForm?.addEventListener("submit", savePlayer);
  verifyForm?.addEventListener("submit", verifyPlayer);
  resendCodeButton?.addEventListener("click", resendVerificationCode);
  document.querySelectorAll("[data-avatar]").forEach((button) => {
    button.addEventListener("click", () => saveAvatar(button.dataset.avatar));
  });
  avatarUpload?.addEventListener("change", saveUploadedAvatar);
  reminderButton?.addEventListener("click", enableVoteReminders);
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

async function loadActivePlayer() {
  const unix = localStorage.getItem(ACTIVE_UNIX_KEY);
  if (!unix) return null;
  const { player } = await apiGet(`/api/players/${encodeURIComponent(unix)}`);
  return player;
}

async function savePlayer(event) {
  event.preventDefault();
  const payload = {
    unix: unixInput.value.trim().toLowerCase(),
    email: emailInput.value.trim().toLowerCase(),
    realName: realNameInput.value.trim(),
    screenName: screenNameInput.value.trim(),
    avatar: activePlayer?.avatar || "💜",
    avatarImage: activePlayer?.avatarImage,
  };
  const { player } = await apiPost("/api/players", payload);
  localStorage.setItem(ACTIVE_UNIX_KEY, player.unix);
  activePlayer = player;
  syncPlayerView();
  if (player.verificationCode) {
    showVerificationMessage(`Testing code: ${player.verificationCode}`);
  } else if (!player.verified) {
    showVerificationMessage(`Verification code sent to ${player.email}.`);
  }
  await renderPageData();
}

function syncPlayerView() {
  if (!playerForm || !profileCard || !startButton || !playerStatus) return;

  if (!activePlayer) {
    playerForm.classList.remove("hidden");
    profileCard.classList.add("hidden");
    verifyForm?.classList.add("hidden");
    verifyStatus?.classList.add("hidden");
    stopResendCountdown();
    startButton.disabled = true;
    playerStatus.textContent = "Save your player profile before guessing.";
    return;
  }

  unixInput.value = activePlayer.unix;
  emailInput.value = activePlayer.email || "";
  realNameInput.value = activePlayer.realName;
  screenNameInput.value = activePlayer.screenName;
  playerForm.classList.add("hidden");
  profileCard.classList.remove("hidden");
  startButton.disabled = !activePlayer.verified;
  playerStatus.textContent = activePlayer.verified
    ? `Playing as ${activePlayer.screenName}. Each photo can only be answered once.`
    : `Profile saved for ${activePlayer.email}. Verify before voting.`;
  verifyForm?.classList.toggle("hidden", activePlayer.verified);
  verifyStatus?.classList.toggle("hidden", activePlayer.verified);
  syncResendButton();
  renderProfile();
}

async function verifyPlayer(event) {
  event.preventDefault();
  if (!activePlayer) return;

  try {
    const { player } = await apiPost("/api/verify-player", {
      unix: activePlayer.unix,
      code: verifyCodeInput.value.trim(),
    });
    activePlayer = player;
    showVerificationMessage("Profile verified. You can vote now.");
    syncPlayerView();
  } catch (error) {
    showVerificationMessage(error.message);
  }
}

function showVerificationMessage(message) {
  if (!verifyStatus) return;
  verifyStatus.classList.remove("hidden");
  verifyStatus.textContent = message;
}

async function resendVerificationCode() {
  if (!activePlayer || !resendCodeButton) return;

  resendCodeButton.disabled = true;
  try {
    const { player } = await apiPost("/api/resend-verification", { unix: activePlayer.unix });
    activePlayer = player;
    showVerificationMessage(player.verificationCode ? `New testing code: ${player.verificationCode}` : "Code resent. Check your Williams email.");
    syncResendButton();
  } catch (error) {
    showVerificationMessage(error.message);
    syncResendButton();
  }
}

function syncResendButton() {
  if (!resendCodeButton) return;
  stopResendCountdown();

  if (!activePlayer || activePlayer.verified) {
    resendCodeButton.disabled = true;
    resendCodeButton.textContent = "Resend code";
    return;
  }

  updateResendButton();
  resendTimerId = window.setInterval(updateResendButton, 1000);
}

function updateResendButton() {
  if (!resendCodeButton || !activePlayer) return;
  const sentAt = new Date(activePlayer.verificationSentAt || 0).getTime();
  const secondsLeft = Math.max(0, Math.ceil((sentAt + 60000 - Date.now()) / 1000));

  resendCodeButton.disabled = secondsLeft > 0;
  resendCodeButton.textContent = secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code";

  if (secondsLeft === 0) stopResendCountdown();
}

function stopResendCountdown() {
  if (!resendTimerId) return;
  window.clearInterval(resendTimerId);
  resendTimerId = null;
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
  profileMeta.textContent = `${activePlayer.realName} · ${activePlayer.unix}`;
}

async function saveAvatar(avatar) {
  if (!activePlayer) return;
  const { player } = await apiPost("/api/players", { ...activePlayer, avatar, avatarImage: undefined });
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
  if (!activePlayer) {
    playerStatus.textContent = "Create your profile first.";
    return;
  }
  if (!activePlayer.verified) {
    playerStatus.textContent = "Verify your Williams email before voting.";
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

  questionCount.textContent = `${currentQuestionIndex + 1} / ${appData.questions.length}`;
  scoreText.textContent = await getActiveScore();
  answers.replaceChildren();
  quizPhoto.src = question.image;
  photoCaption.textContent = getQuestionCaption(question, existingVote);

  question.options.forEach((option) => {
    const button = document.createElement("button");
    button.className = "answer-button";
    button.type = "button";
    button.textContent = option;
    button.disabled = Boolean(existingVote) || question.revealed;

    if (existingVote?.choice === option && !question.revealed) button.classList.add("selected");
    if (question.revealed && question.answer === option) button.classList.add("correct");
    if (question.revealed && existingVote?.choice === option && question.answer !== option) button.classList.add("wrong");

    button.addEventListener("click", () => submitVote(question, option, button));
    answers.append(button);
  });

  updateDeadlineClock(question);
  clearInterval(timerId);
  if (!question.revealed) {
    timerId = setInterval(() => updateDeadlineClock(question), 1000);
  }
}

async function submitVote(question, choice, button) {
  try {
    await apiPost("/api/votes", { unix: activePlayer.unix, questionId: question.id, choice });
    button.classList.add("selected");
    [...answers.children].forEach((item) => {
      item.disabled = true;
    });
    photoCaption.textContent = `Your answer was saved. The correct location and points unlock after ${formatDate(question.deadlineAt)}.`;
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
  resultMessage.textContent = "Your selections were saved. Correct answers and points appear after each photo's 24-hour deadline.";
}

function getQuestionCaption(question, existingVote) {
  if (question.revealed && existingVote) {
    return `Revealed: correct answer is ${question.answer}. You chose ${existingVote.choice}.`;
  }
  if (question.revealed) return `Revealed: correct answer is ${question.answer}.`;
  if (existingVote) return `Your answer was saved. The correct location unlocks after ${formatDate(question.deadlineAt)}.`;
  return `${question.title}: choose once before ${formatDate(question.deadlineAt)}.`;
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
  await Promise.all([renderLeaderboard(), renderHistory(), renderPodium()]);
}

async function renderLeaderboard() {
  if (!leaderboardList) return;
  const { leaders, columns } = await apiGet("/api/leaderboard");
  const headerCells = document.querySelectorAll(".leaderboard-table thead th");

  columns.forEach((column, index) => {
    const header = headerCells[index + 3];
    const imageIndex = (index % 6) + 1;
    if (header) {
      header.innerHTML = `<span class="location-head"><img src="assests/photos/sample-${imageIndex}.svg" alt="" />${column}</span>`;
    }
  });

  leaderboardList.innerHTML = leaders
    .map(
      (leader, index) => `
        <tr>
          <td>${leader.rank || index + 1}</td>
          <td>${leader.screenName}</td>
          <td>${leader.points}</td>
          ${columns.map((column) => `<td>${leader.scores?.[column] ?? "-"}</td>`).join("")}
        </tr>
      `
    )
    .join("");
}

async function renderHistory() {
  if (!historyList && !historyTableBody) return;
  const votes = await getActiveHistory();

  if (historyList) {
    historyList.innerHTML = votes.length
      ? votes.map((vote) => `<article class="history-item"><strong>${vote.title}</strong><span>${historyText(vote)}</span><b>${vote.revealed ? `${vote.points} pts` : "Pending"}</b></article>`).join("")
      : "<p>No history yet. Save your profile and make your first guess.</p>";
  }

  if (historyTableBody) {
    historyTableBody.innerHTML = votes.length
      ? votes.map((vote) => `<tr><td>${vote.title}</td><td>${vote.choice}</td><td>${vote.correctAnswer || "Hidden until deadline"}</td><td>${vote.revealed ? (vote.correct ? "Correct" : "Missed") : "Pending"}</td><td>${vote.correct ? 10 : 0}</td><td>${vote.correct ? vote.bonusPoints : 0}</td><td>${vote.points}</td><td>${formatDate(vote.answeredAt)}</td></tr>`).join("")
      : `<tr><td colspan="8">No voting history yet. Save your player profile on the home page and make your first guess.</td></tr>`;
  }
}

async function renderPodium() {
  if (!championGallery) return;
  const { terms } = await apiGet("/api/podium");
  championGallery.innerHTML = terms
    .map((term) => {
      const winners = [...term.winners].sort((a, b) => ({ 2: 1, 1: 2, 3: 3 })[a.place] - ({ 2: 1, 1: 2, 3: 3 })[b.place]);
      return `<section class="term-podium"><h2>${term.term}</h2><div class="winner-grid olympic-podium">${winners.map((winner) => `<article class="winner-card place-${winner.place}"><img src="${winner.image}" alt="${winner.screenName}" /><div><span>${winner.place}</span><strong>${winner.screenName}</strong><em>${winner.points} pts</em></div></article>`).join("")}</div></section>`;
    })
    .join("");
}

function historyText(vote) {
  if (!vote.revealed) return `Saved: ${vote.choice}. Answer hidden until the deadline.`;
  return `${vote.choice} ${vote.correct ? "was correct" : `missed: ${vote.correctAnswer}`}`;
}

function showScreen(screenToShow) {
  introScreen.classList.add("hidden");
  quizScreen.classList.add("hidden");
  resultsScreen.classList.add("hidden");
  screenToShow.classList.remove("hidden");
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
    new Notification("Where Is This Williams", { body: "Reminders are on. I will nudge you when the next photo is posted." });
  }
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
    reminderStatus.textContent = "Reminder saved for the next posted photo.";
    return;
  }
  reminderButton.textContent = "Enable Vote Reminders";
  reminderButton.disabled = false;
  reminderStatus.textContent = "Get a browser reminder when the next photo is posted.";
}

function scheduleVoteReminder() {
  if (localStorage.getItem(REMINDERS_KEY) !== "yes" || !("Notification" in window) || Notification.permission !== "granted") return;
  const nextQuestion = appData.questions.find((question) => new Date(question.postedAt).getTime() > Date.now());
  if (!nextQuestion) return;
  window.setTimeout(() => {
    new Notification("New Williams photo is live", { body: `${nextQuestion.title} is posted. Make your guess before the deadline.` });
  }, Math.min(new Date(nextQuestion.postedAt).getTime() - Date.now(), 2147483647));
}

function updateDeadlineClock(question) {
  if (!timerText) return;
  const remaining = new Date(question.deadlineAt).getTime() - Date.now();
  if (remaining <= 0) {
    timerText.textContent = "Revealed";
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
