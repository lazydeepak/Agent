use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use std::thread;

#[derive(Debug, Clone)]
pub struct ReadinessResult {
    pub ready: bool,
    pub endpoint: Option<String>,
    pub error: Option<String>,
    #[allow(dead_code)]
    pub timeout: bool,
}

pub struct SidecarConfig {
    pub node_path: String,
    pub bundle_path: String,
    pub token: String,
    pub config_path: Option<String>,
    pub db_path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SidecarState {
    pub running: bool,
    pub ready: bool,
    pub endpoint: Option<String>,
    pub token: Option<String>,
    pub last_exit_reason: Option<String>,
    pub restart_attempts: u32,
    pub restart_budget_exhausted: bool,
}

pub struct SidecarManager {
    child: Option<Child>,
    state: SidecarState,
    stdout_rx: Option<mpsc::Receiver<String>>,
}

impl SidecarManager {
    pub fn new(config: SidecarConfig) -> Self {
        Self {
            child: None,
            state: SidecarState {
                running: false,
                ready: false,
                endpoint: None,
                token: Some(config.token.clone()),
                last_exit_reason: None,
                restart_attempts: 0,
                restart_budget_exhausted: false,
            },
            stdout_rx: None,
        }
    }

    pub fn start(&mut self, config: SidecarConfig) -> Result<(), String> {
        if self.state.running {
            return Err("Sidecar already running; single-flight enforced.".to_string());
        }
        if self.state.restart_budget_exhausted {
            return Err("Restart budget exhausted; manual restart required.".to_string());
        }
        self.state.restart_attempts += 1;
        if self.state.restart_attempts > 3 {
            self.state.restart_budget_exhausted = true;
            return Err("Restart attempts exceeded bounded budget.".to_string());
        }

        let token = config.token.clone();

        let mut cmd = Command::new(&config.node_path);
        cmd.arg(&config.bundle_path)
            .arg("service")
            .arg("start")
            .env("MANAGED_SIDECAR_MODE", "1")
            .env("RELAY_MANAGED_LOCAL", "1")
            .env("RELAY_REMOTE_TOKEN", &token)
            .env("RELAY_REMOTE_HOST", "127.0.0.1")
            .env("RELAY_REMOTE_PORT", "0")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(cp) = &config.config_path {
            cmd.arg("--config").arg(cp);
        }
        if let Some(db) = &config.db_path {
            cmd.arg("--db").arg(db);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        // Take stdout and spawn a reader thread that sends lines over a channel.
        let stdout = child.stdout.take();
        let (tx, rx) = mpsc::channel();
        self.stdout_rx = Some(rx);

        thread::spawn(move || {
            if let Some(stdout) = stdout {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            if tx.send(l).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        });

        // Drain stderr so a chatty service never blocks on a full pipe buffer.
        // Lines are echoed to the console for diagnostics, never parsed.
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(l) => eprintln!("[sidecar-stderr] {}", l),
                        Err(_) => break,
                    }
                }
            });
        }

        self.child = Some(child);
        self.state.running = true;
        self.state.ready = false;
        self.state.endpoint = None;
        self.state.last_exit_reason = None;
        Ok(())
    }

    pub fn shutdown(&mut self) -> Result<(), String> {
        self.state.running = false;
        self.state.ready = false;
        if let Some(mut child) = self.child.take() {
            if let Some(stdin) = child.stdin.as_mut() {
                use std::io::Write;
                let _ = stdin.write_all(b"SHUTDOWN\n");
            }
            let start = Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        self.state.last_exit_reason = Some(format!("exited: {}", status));
                        break;
                    }
                    Ok(None) => {
                        if start.elapsed() > Duration::from_millis(5000) {
                            let _ = child.kill();
                            self.state.last_exit_reason = Some("killed after timeout".into());
                            break;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        let _ = child.kill();
                        self.state.last_exit_reason = Some(format!("wait error: {}", e));
                        break;
                    }
                }
            }
            let _ = child.wait();
        }
        Ok(())
    }

    /// Read from the stdout channel, looking for the agent-relay-ready JSON.
    /// Returns when readiness is found, error occurs, or timeout is exceeded.
    pub fn observe_readiness(&mut self, timeout_ms: u64) -> ReadinessResult {
        let start = Instant::now();
        if self.state.ready {
            return ReadinessResult {
                ready: true,
                endpoint: self.state.endpoint.clone(),
                error: None,
                timeout: false,
            };
        }
        if let Some(rx) = self.stdout_rx.take() {
            loop {
                let elapsed = start.elapsed().as_millis() as u64;
                if elapsed >= timeout_ms {
                    return ReadinessResult {
                        ready: false,
                        endpoint: None,
                        error: Some("Readiness handshake timeout exceeded.".into()),
                        timeout: true,
                    };
                }
                let remaining = timeout_ms.saturating_sub(elapsed);
                match rx.recv_timeout(Duration::from_millis(remaining.min(200))) {
                    Ok(line) => {
                        let trimmed = line.trim();
                        if let Some(rest) = trimmed.strip_prefix("{\"type\":\"agent-relay-ready\"") {
                            let host = extract_json_string(rest, "host").unwrap_or_else(|| "127.0.0.1".into());
                            let port = extract_json_number(rest, "port").unwrap_or(8181);
                            let endpoint = format!("http://{}:{}", host, port);
                            self.state.ready = true;
                            self.state.endpoint = Some(endpoint.clone());
                            return ReadinessResult {
                                ready: true,
                                endpoint: Some(endpoint),
                                error: None,
                                timeout: false,
                            };
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        continue;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        return ReadinessResult {
                            ready: false,
                            endpoint: None,
                            error: Some("Service stdout closed before readiness.".into()),
                            timeout: false,
                        };
                    }
                }
            }
        } else {
            ReadinessResult {
                ready: false,
                endpoint: None,
                error: Some("No stdout channel available.".into()),
                timeout: false,
            }
        }
    }

    pub fn get_state(&self) -> SidecarState {
        SidecarState {
            running: self.state.running,
            ready: self.state.ready,
            endpoint: self.state.endpoint.clone(),
            token: self.state.token.clone(),
            last_exit_reason: self.state.last_exit_reason.clone(),
            restart_attempts: self.state.restart_attempts,
            restart_budget_exhausted: self.state.restart_budget_exhausted,
        }
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

/// Extract a string value from a JSON-like line: `"key":"value"`.
fn extract_json_string(json: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\":\"", key);
    let start = json.find(&pattern)? + pattern.len();
    let rest = &json[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Extract a numeric value from a JSON-like line: `"key":123`.
fn extract_json_number(json: &str, key: &str) -> Option<u16> {
    let pattern = format!("\"{}\":", key);
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start();
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    rest[..end].parse::<u16>().ok()
}