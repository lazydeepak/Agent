import { runAction } from "./actions.js";
import { toast } from "./dom.js";

export async function showWorkerQuestions(pairId: string): Promise<void> {
  if (document.getElementById("worker-questions-dialog")) return;
  const questions = await runAction(() => window.desktop.listWorkerQuestions(pairId));
  if (!questions) return;
  if (!questions.length) { toast("The bound worker has no pending questions.", "ok"); return; }
  if (document.getElementById("worker-questions-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "worker-questions-dialog";
  dialog.style.cssText = "width:min(680px,90vw);max-height:80vh;overflow:auto;padding:24px";
  const heading = document.createElement("h2");
  heading.textContent = `Worker questions: ${pairId}`;
  dialog.appendChild(heading);
  for (const request of questions) {
    const section = document.createElement("section");
    const fields = request.questions.map((question) => {
      const label = document.createElement("label");
      const description = document.createElement("p");
      description.textContent = question.question;
      const choices = document.createElement("p");
      choices.textContent = question.options.map((option) => `${option.label}: ${option.description ?? ""}`).join(" · ");
      const field = document.createElement("textarea");
      field.rows = 5;
      field.maxLength = 32000;
      field.style.width = "100%";
      label.append(description, choices, field);
      section.appendChild(label);
      return field;
    });
    const send = document.createElement("button");
    send.textContent = "Send answer to this worker";
    send.className = "btn-sm btn-primary";
    send.onclick = async () => {
      if (fields.some((field) => !field.value.trim())) { toast("Answer every question before sending."); return; }
      send.disabled = true;
      const result = await runAction(() => window.desktop.answerWorkerQuestion(pairId, {
        requestId: request.id, answers: fields.map((field) => [field.value.trim()])
      }));
      if (result) {
        section.remove();
        toast("Worker answer accepted.", "ok");
        if (!dialog.querySelector("section")) dialog.close();
      } else {
        // An uncertain reply must be refreshed, never automatically replayed.
        send.textContent = "Close and refresh questions before retrying";
      }
    };
    section.appendChild(send);
    dialog.appendChild(section);
  }
  const close = document.createElement("button");
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  dialog.appendChild(close);
  dialog.onclose = () => dialog.remove();
  document.body.appendChild(dialog);
  dialog.showModal();
}
