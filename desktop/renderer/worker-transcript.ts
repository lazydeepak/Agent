import { showWorkerQuestions } from "./worker-questions.js";

export async function showWorkerTranscript(pairId: string): Promise<void> {
  if (document.getElementById("worker-transcript-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "worker-transcript-dialog";
  dialog.style.cssText = "width:min(1100px,94vw);height:85vh;padding:24px;overflow:hidden";
  const heading = document.createElement("h2");
  heading.textContent = "Live worker session";
  const status = document.createElement("p");
  const note = document.createElement("p");
  note.textContent = "Read-only relay API view · latest 40 messages · auto-refresh every 3s. When bound to the same session as OpenCode Desktop, refresh Desktop to confirm planner traffic appears there.";
  const body = document.createElement("div");
  body.style.cssText = "overflow:auto;min-height:0;flex:1";
  const close = document.createElement("button");
  close.textContent = "Close live session";
  close.onclick = () => dialog.close();
  const question = document.createElement("button");
  question.textContent = "Answer pending question";
  question.onclick = () => { void showWorkerQuestions(pairId); };
  dialog.append(heading, status, note, close, question, body);
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.style.display = "flex";
  dialog.style.flexDirection = "column";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let boundSession: string | undefined;
  let previousContent = "";
  dialog.onclose = () => { clearTimeout(timer); dialog.remove(); };
  const refresh = async () => {
    try {
      const result = await window.desktop.getWorkerTranscript(pairId);
      if (!dialog.open) return;
      if (boundSession && boundSession !== result.sessionId) throw new Error("Pair binding changed. Close and reopen this view.");
      boundSession = result.sessionId;
      heading.textContent = result.title;
      status.textContent = `${result.sessionId} · ${result.repoPath} · ${result.model} · ${result.waitingForInput ? "Waiting for answer" : result.running ? "Working" : "Idle — awaiting next planner task"} · Checked ${new Date(result.checkedAt).toLocaleTimeString()}`;
      const content = JSON.stringify(result.messages);
      if (content !== previousContent) {
        const follow = !previousContent || body.scrollHeight - body.scrollTop - body.clientHeight < 100;
        body.replaceChildren();
        for (const message of result.messages) {
          const label = document.createElement("h3");
          label.textContent = `${message.role} · ${new Date(message.createdAt).toLocaleString()} · ${message.id}`;
          const text = document.createElement("pre");
          text.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;font:inherit";
          text.textContent = message.text || "[No visible text yet]";
          body.append(label, text);
        }
        previousContent = content;
        if (follow) body.scrollTop = body.scrollHeight;
      }
    } catch (error) {
      if (!dialog.open) return;
      status.textContent = `Live check failed — displayed messages may be stale: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
    if (dialog.open) timer = setTimeout(() => { void refresh(); }, 3000);
  };
  await refresh();
}
