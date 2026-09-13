const form = document.querySelector("#admin-question-form");
const statusText = document.querySelector("#admin-status");

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
