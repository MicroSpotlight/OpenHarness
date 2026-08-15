//! Native desktop host for OpenHarness.
//!
//! Spawns the bundled `dsh web` server as a supervised child process (auto
//! restart on crash), hosts the browser UI in native windows (one window =
//! one session), lives in the macOS menu bar (tray), and enforces a single
//! app instance. The bundled Node runtime and `@deepseek-ai/dsh` node_modules
//! live under the app's resource directory (`runtime/**` in tauri.conf.json).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use url::{Host, Url};

/// How long to wait for the DSH server to print its URL before giving up.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
/// Consecutive spawn failures before surfacing an error dialog.
const MAX_RESTART_ATTEMPTS: u32 = 3;

/// Shared backend state: the running child PID (for quit-time kill), the
/// current canonical URL (for windows), and coordination flags.
struct BackendState {
    child_pid: Mutex<Option<u32>>,
    url: Mutex<Option<Url>>,
    url_cv: Condvar,
    quitting: AtomicBool,
    window_seq: AtomicU32,
}

impl BackendState {
    fn new() -> Self {
        Self {
            child_pid: Mutex::new(None),
            url: Mutex::new(None),
            url_cv: Condvar::new(),
            quitting: AtomicBool::new(false),
            window_seq: AtomicU32::new(0),
        }
    }

    fn set_url(&self, url: Url) {
        let mut guard = self.url.lock().unwrap();
        *guard = Some(url);
        self.url_cv.notify_all();
    }

    fn current_url(&self) -> Option<Url> {
        self.url.lock().unwrap().clone()
    }

    fn wait_url(&self, timeout: Duration) -> Option<Url> {
        let guard = self.url.lock().unwrap();
        let (guard, _) = self
            .url_cv
            .wait_timeout_while(guard, timeout, |url| url.is_none())
            .unwrap();
        guard.clone()
    }
}

/// Extract the URL from the `dsh web: http://127.0.0.1:PORT` boot line,
/// accepting only loopback HTTP URLs with an explicit port and no credentials.
fn parse_url(line: &str) -> Option<Url> {
    const MARKER: &str = "dsh web: ";
    let rest = line.find(MARKER).map(|i| &line[i + MARKER.len()..])?;
    let candidate = rest.split_whitespace().next()?;
    let url = Url::parse(candidate).ok()?;

    if url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_none()
    {
        return None;
    }

    match url.host()? {
        Host::Ipv4(address) if address.is_loopback() => Some(url),
        Host::Ipv6(address) if address.is_loopback() => Some(url),
        Host::Domain(domain) if domain.eq_ignore_ascii_case("localhost") => Some(url),
        _ => None,
    }
}

fn wait_for_startup_url(
    output: &mpsc::Receiver<Result<String, std::io::Error>>,
    timeout: Duration,
) -> Result<Url, std::io::Error> {
    let deadline = Instant::now() + timeout;

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(startup_timeout_error());
        }

        match output.recv_timeout(remaining) {
            Ok(Ok(line)) => {
                if let Some(url) = parse_url(&line) {
                    return Ok(url);
                }
            }
            Ok(Err(error)) => return Err(error),
            Err(mpsc::RecvTimeoutError::Timeout) => return Err(startup_timeout_error()),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "dsh web exited before reporting its URL",
                ));
            }
        }
    }
}

fn startup_timeout_error() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "timed out waiting for the dsh web server to report its URL",
    )
}

/// Locate the bundled Node binary and the `dsh` entry script inside the app
/// resources. Handles both the directory-preserving and directory-flattening
/// ways Tauri can lay out a bundled `runtime` resource.
fn resolve_runtime(resource_dir: &Path) -> Result<(PathBuf, PathBuf), String> {
    let bases = [resource_dir.join("runtime"), resource_dir.to_path_buf()];
    for base in bases {
        let node = base.join("node");
        let bin = base
            .join("dsh")
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("lib")
            .join("bin.js");
        if node.exists() && bin.exists() {
            return Ok((node, bin));
        }
    }
    Err(format!(
        "bundled runtime not found under {} (expected runtime/node and runtime/dsh/node_modules)",
        resource_dir.display()
    ))
}

/// Read DeepSeek-related environment variables from the user's login shell
/// (`~/.zshrc` etc.). The Finder does not inherit shell environment, so a
/// `DEEPSEEK_API_KEY` exported in the shell profile would otherwise be missing
/// from the backend. Runs once at startup; the token value is never logged.
fn load_shell_env() -> Vec<(String, String)> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let Ok(output) = Command::new(&shell).args(["-lic", "env"]).output() else {
        return Vec::new();
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            let key = key.trim();
            if key.starts_with("DEEPSEEK_") && !value.is_empty() {
                Some((key.to_string(), value.to_string()))
            } else {
                None
            }
        })
        .collect()
}

/// Spawn the DSH web server and block until it reports its canonical URL.
fn spawn_harness(
    resource_dir: &Path,
    home: &Path,
    shell_env: &[(String, String)],
) -> Result<(Child, Url), Box<dyn std::error::Error>> {
    let (node, bin) = resolve_runtime(resource_dir)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;

    let mut command = Command::new(node);
    command
        .arg(bin)
        .args(["web", "--port", "0"])
        .env("DSH_TELEMETRY_DISABLED", "1")
        .current_dir(home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Inject the DeepSeek env vars read from the login shell. Only fill gaps:
    // an inherited (e.g. terminal-launched) value wins.
    for (key, value) in shell_env {
        if std::env::var_os(key).is_none() {
            command.env(key, value);
        }
    }
    let mut child = command
        .spawn()
        .map_err(|e| std::io::Error::other(format!("failed to spawn dsh: {e}")))?;

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    // Forward the server's stderr to our own so startup failures are visible.
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => eprint!("{line}"),
            }
        }
    });

    let (output_tx, output_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end().to_owned();
                    if !trimmed.is_empty() {
                        eprintln!("[harness] {trimmed}");
                    }
                    let _ = output_tx.send(Ok(trimmed));
                }
                Err(error) => {
                    let _ = output_tx.send(Err(error));
                    break;
                }
            }
        }
    });

    match wait_for_startup_url(&output_rx, STARTUP_TIMEOUT) {
        Ok(url) => Ok((child, url)),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error.into())
        }
    }
}

/// Supervise the harness backend: spawn it, keep its URL published, and restart
/// it (with backoff) if it exits unexpectedly. Runs until the app quits.
fn backend_supervisor(
    state: Arc<BackendState>,
    resource_dir: PathBuf,
    home: PathBuf,
    shell_env: Vec<(String, String)>,
    app: tauri::AppHandle,
) {
    let mut failures: u32 = 0;
    let mut error_reported = false;
    loop {
        if state.quitting.load(Ordering::SeqCst) {
            break;
        }

        match spawn_harness(&resource_dir, &home, &shell_env) {
            Ok((mut child, url)) => {
                failures = 0;
                error_reported = false;

                let pid = child.id();
                *state.child_pid.lock().unwrap() = Some(pid);
                state.set_url(url.clone());

                // Point every existing window at the (new) backend. On the
                // first spawn there are no windows yet, so this is a no-op.
                for (_, window) in app.webview_windows() {
                    let _ = window.navigate(url.clone());
                }

                // Block until the backend exits (crash or quit-time kill).
                let _ = child.wait();
                *state.child_pid.lock().unwrap() = None;

                if state.quitting.load(Ordering::SeqCst) {
                    break;
                }
                eprintln!("[harness] backend exited unexpectedly; restarting");
                std::thread::sleep(Duration::from_secs(1));
            }
            Err(e) => {
                failures += 1;
                eprintln!("[harness] backend spawn failed ({failures}): {e}");
                if failures >= MAX_RESTART_ATTEMPTS && !error_reported {
                    error_reported = true;
                    show_backend_error(&app, &e);
                }
                let backoff = 2u64.saturating_pow(failures.min(6)).min(30);
                std::thread::sleep(Duration::from_secs(backoff));
            }
        }
    }
    eprintln!("[harness] backend supervisor exiting");
}

/// Surface a native error dialog when the backend cannot start.
fn show_backend_error(app: &tauri::AppHandle, err: &dyn std::fmt::Display) {
    let _ = app
        .dialog()
        .message(format!("OpenHarness 后端启动失败：{err}"))
        .title("OpenHarness")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// Pick the label for the next window; "main" first, then "session-N".
fn next_window_label(state: &Arc<BackendState>) -> String {
    let n = state.window_seq.fetch_add(1, Ordering::SeqCst);
    if n == 0 {
        "main".to_string()
    } else {
        format!("session-{n}")
    }
}

/// Resolve the URL a new window should load (the live backend, or the bundled
/// "starting" stub while the backend is not ready).
fn window_url(state: &Arc<BackendState>) -> WebviewUrl {
    match state.current_url() {
        Some(url) => WebviewUrl::External(url),
        None => WebviewUrl::App("index.html".into()),
    }
}

/// Create a new native window hosting the harness browser UI.
///
/// Theme is left at its default (`None`) so each window follows the system
/// dark/light appearance.
fn create_window(app: &tauri::AppHandle, state: &Arc<BackendState>) -> tauri::Result<()> {
    let label = next_window_label(state);
    let url = window_url(state);
    WebviewWindowBuilder::new(app, label, url)
        .title("OpenHarness")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .build()?;
    Ok(())
}

/// Show (and focus) the primary window, used by tray / dock re-activation.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Build the menu-bar (tray) icon and its menu.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let new = MenuItem::with_id(app, "new", "新建窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new, &quit])?;

    let tray_app = app.clone();
    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .tooltip("OpenHarness")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "new" => {
                let state = app.state::<Arc<BackendState>>();
                let _ = create_window(app, state.inner());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(&tray_app);
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch was requested: re-focus the existing instance.
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let home = app.path().home_dir()?;
            let state = Arc::new(BackendState::new());

            // Load DeepSeek env vars (e.g. DEEPSEEK_API_KEY) from the login
            // shell once, then hand them to the backend supervisor.
            let shell_env = load_shell_env();
            if !shell_env.is_empty() {
                eprintln!(
                    "[harness] loaded {} DeepSeek env var(s) from the login shell",
                    shell_env.len()
                );
            }

            // Supervise the backend in a background thread.
            let supervisor = std::thread::spawn({
                let state = state.clone();
                let app = app.handle().clone();
                let resource_dir = resource_dir.clone();
                let home = home.clone();
                move || backend_supervisor(state, resource_dir, home, shell_env, app)
            });
            // Keep the handle so the thread is not detached silently.
            let _ = supervisor;

            // Wait for the backend's first URL before opening the window.
            state.wait_url(STARTUP_TIMEOUT);
            let _ = create_window(app.handle(), &state);

            app.manage(state);
            build_tray(app.handle())?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OpenHarness app")
        .run(|app_handle, event| match event {
            RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                // Close-to-tray: hide instead of destroying the window, so the
                // backend and its session stay alive in the menu bar.
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window(&label) {
                    let _ = window.hide();
                }
            }
            RunEvent::Exit => {
                let state = app_handle.state::<Arc<BackendState>>();
                state.quitting.store(true, Ordering::SeqCst);
                let pid = state.child_pid.lock().unwrap().take();
                if let Some(pid) = pid {
                    unsafe { libc::kill(pid as i32, libc::SIGTERM) };
                }
            }
            // macOS: clicking the Dock icon with no visible windows reopens.
            #[allow(unreachable_patterns)]
            RunEvent::Reopen { .. } => show_main_window(app_handle),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_loopback_urls() {
        assert_eq!(
            parse_url("dsh web: http://127.0.0.1:3080")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:3080/"
        );
        assert_eq!(
            parse_url("dsh web: http://[::1]:3080").unwrap().as_str(),
            "http://[::1]:3080/"
        );
        assert_eq!(
            parse_url("[harness] dsh web: http://localhost:3080")
                .unwrap()
                .as_str(),
            "http://localhost:3080/"
        );
    }

    #[test]
    fn rejects_non_loopback_or_unsafe_urls() {
        assert!(parse_url("dsh web: https://127.0.0.1:3080").is_none());
        assert!(parse_url("dsh web: http://192.168.1.2:3080").is_none());
        assert!(parse_url("dsh web: http://example.com:3080").is_none());
        assert!(parse_url("dsh web: http://user@127.0.0.1:3080").is_none());
        assert!(parse_url("dsh web: http://127.0.0.1").is_none());
        assert!(parse_url("server ready").is_none());
    }

    #[test]
    fn startup_wait_honors_timeout_without_output() {
        let (_sender, receiver) = mpsc::channel();
        let error = wait_for_startup_url(&receiver, Duration::from_millis(20)).unwrap_err();

        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
    }
}
