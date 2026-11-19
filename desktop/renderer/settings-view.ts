export async function wireConfigForm(): Promise<void> {
  const opencodeUrl = document.getElementById("config-opencode-url") as HTMLInputElement | null;
  const chatgptUrl = document.getElementById("config-chatgpt-url") as HTMLInputElement | null;
  const status = document.getElementById("config-status");
  const save = document.getElementById("config-save-settings");
  const connect = document.getElementById("config-opencode-connect");
  const reset = document.getElementById("config-reset-settings");
  if (!save || !opencodeUrl || !chatgptUrl || !status) return;
  try {
    const [workerEndpoint, plannerEndpoint] = await Promise.all([
      window.desktop.getOpenCodeEndpoint(),
      window.desktop.getChatGptEndpoint()
    ]);
    opencodeUrl.value = workerEndpoint;
    chatgptUrl.value = plannerEndpoint;
  } catch {
    // Keep the page defaults when endpoint discovery is unavailable.
  }
  save.addEventListener("click", async () => {
    const settings = { opencodeServer: opencodeUrl.value, chatgptUrl: chatgptUrl.value };
    try {
      if (typeof window.desktop?.adapterSettings === "function") {
        await window.desktop.adapterSettings(settings);
        status.textContent = "Saved — adapter reload queued.";
        status.classList.toggle("ok", true);
        status.classList.remove("fail");
      } else {
        status.textContent = "Desktop API not exposed.";
        status.classList.toggle("fail", true);
        status.classList.remove("ok");
      }
    } catch (error) {
      status.textContent = "Error: " + (error instanceof Error ? error.message : String(error));
      status.classList.toggle("fail", true);
      status.classList.remove("ok");
    }
  });
  connect?.addEventListener("click", async () => {
    try {
      const result = await window.desktop.configureOpenCodeCredentials();
      status.textContent = result.saved
        ? `OpenCode credentials saved securely for ${result.username}.`
        : "OpenCode credentials were not changed.";
      status.classList.toggle("ok", result.saved);
      status.classList.remove("fail");
    } catch (error) {
      status.textContent = "Error: " + (error instanceof Error ? error.message : String(error));
      status.classList.toggle("fail", true);
      status.classList.remove("ok");
    }
  });
  reset?.addEventListener("click", () => {
    status.textContent = "";
    status.classList.remove("ok", "fail");
  });
}

export async function wireSettingsSection(): Promise<void> {
  const input = document.getElementById("history-retention-days") as HTMLInputElement | null;
  const save = document.getElementById("history-retention-save");
  const status = document.getElementById("history-retention-status");
  if (!input || !save || !status) return;
  try {
    if (typeof window.desktop?.getSettings === "function") {
      const settings = await window.desktop.getSettings();
      input.value = settings.historyRetentionDays ? String(settings.historyRetentionDays) : "";
      const sync = document.getElementById("sync-dev-projects-on-startup") as HTMLInputElement | null;
      if (sync) sync.checked = settings.syncDevProjectsOnStartup !== false;
      const root = document.getElementById("dev-projects-root") as HTMLInputElement | null;
      if (root && settings.devProjectsRoot) root.value = settings.devProjectsRoot;
    }
  } catch {
    // Leave the field empty (= keep forever) rather than fabricate a setting.
  }
  save.addEventListener("click", async () => {
    if (typeof window.desktop?.updateSettings !== "function") {
      status.textContent = "Desktop API not exposed.";
      status.classList.toggle("fail", true);
      status.classList.remove("ok");
      return;
    }
    const raw = input.value.trim();
    const days = raw === "" ? 0 : Number.parseInt(raw, 10);
    if (Number.isNaN(days) || days < 0) {
      status.textContent = "Enter a whole number of days (0 = keep forever).";
      status.classList.toggle("fail", true);
      status.classList.remove("ok");
      return;
    }
    try {
      const sync = (document.getElementById("sync-dev-projects-on-startup") as HTMLInputElement | null)?.checked ?? true;
      const root = (document.getElementById("dev-projects-root") as HTMLInputElement | null)?.value.trim() ?? "";
      const saved = await window.desktop.updateSettings({
        ...(days > 0 ? { historyRetentionDays: days } : {}),
        syncDevProjectsOnStartup: sync,
        ...(root ? { devProjectsRoot: root } : {})
      });
      status.textContent = saved.historyRetentionDays
        ? `Saved — history kept for ${saved.historyRetentionDays} days. Older rows were archived/deleted now.`
        : "Saved — history kept forever.";
      status.classList.toggle("ok", true);
      status.classList.remove("fail");
    } catch (error) {
      status.textContent = "Error: " + (error instanceof Error ? error.message : String(error));
      status.classList.toggle("fail", true);
      status.classList.remove("ok");
    }
  });
  document.getElementById("sync-dev-projects-now")?.addEventListener("click", async () => {
    const status = document.getElementById("project-sync-status");
    try {
      const root = (document.getElementById("dev-projects-root") as HTMLInputElement | null)?.value.trim() ?? "";
      const projects = await window.desktop.syncDevProjects(root || undefined);
      if (status) status.textContent = `Synced ${projects.filter((project) => project.available).length} Git projects. Missing projects remain unavailable.`;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}
