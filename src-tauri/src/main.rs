//! Native desktop host for OpenHarness.
//!
//! Spawns the bundled `dsh web` server as a supervised child process (auto
//! restart on crash), hosts the browser UI in native windows (one window =
//! one session), lives in the macOS menu bar (tray), and enforces a single
//! app instance. The bundled Node runtime and `@deepseek-ai/dsh` node_modules
//! live under the app's resource directory (`runtime/**` in tauri.conf.json).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::cmp::Ordering as CompareOrdering;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use semver::Version;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, Theme, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;
use url::{Host, Url};

/// How long to wait for the DSH server to print its URL before giving up.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
/// Consecutive backend failures before surfacing an error dialog.
const MAX_RESTART_ATTEMPTS: u32 = 3;
/// Runtime long enough to treat an earlier failure streak as recovered.
const STABLE_BACKEND_UPTIME: Duration = Duration::from_secs(30);
const UPDATE_NOTES_LIMIT: usize = 1_200;
const APP_UPDATE_MENU_ID: &str = "app-update";
const WEBVIEW_INIT_SCRIPT: &str = include_str!("../webview-init.js");

#[cfg(target_os = "macos")]
extern "C" {
    fn openharness_install_webview_context_menu_filter();
    fn openharness_preferred_native_locale() -> i32;
}

#[cfg(target_os = "macos")]
fn install_native_context_menu_filter() {
    // The native function is process-global and idempotent via dispatch_once.
    unsafe { openharness_install_webview_context_menu_filter() };
}

#[cfg(not(target_os = "macos"))]
fn install_native_context_menu_filter() {}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UpdateCheckSource {
    Automatic,
    Manual,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NativeLocale {
    Zh,
    En,
}

impl NativeLocale {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "zh" => Some(Self::Zh),
            "en" => Some(Self::En),
            _ => None,
        }
    }

    fn text(self, zh: &'static str, en: &'static str) -> &'static str {
        match self {
            Self::Zh => zh,
            Self::En => en,
        }
    }
}

fn preferred_native_locale() -> NativeLocale {
    #[cfg(target_os = "macos")]
    {
        if unsafe { openharness_preferred_native_locale() } == 1 {
            NativeLocale::En
        } else {
            NativeLocale::Zh
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        NativeLocale::Zh
    }
}

#[derive(Clone, Copy)]
enum UpdateMenuStatus {
    Idle,
    Checking,
    Downloading(Option<u8>),
    Installing,
    Restarting,
}

#[derive(Clone)]
struct AppMenuItems {
    about: PredefinedMenuItem<Wry>,
    update: MenuItem<Wry>,
    services: PredefinedMenuItem<Wry>,
    hide: PredefinedMenuItem<Wry>,
    hide_others: PredefinedMenuItem<Wry>,
    quit: PredefinedMenuItem<Wry>,
}

#[derive(Clone)]
struct TrayMenuItems {
    show: MenuItem<Wry>,
    new: MenuItem<Wry>,
    update: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

#[derive(Clone)]
struct NativeUi {
    locale: Arc<Mutex<NativeLocale>>,
    update_status: Arc<Mutex<UpdateMenuStatus>>,
    app_menu: AppMenuItems,
    tray_menu: TrayMenuItems,
}

struct AppUpdateState {
    busy: AtomicBool,
    automatic_check_started: AtomicBool,
    ui: NativeUi,
}

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

    fn mark_stopped(&self) {
        *self.child_pid.lock().unwrap() = None;
        *self.url.lock().unwrap() = None;
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

fn next_failure_count(current: u32, uptime: Option<Duration>) -> u32 {
    let previous = if uptime.is_some_and(|duration| duration >= STABLE_BACKEND_UPTIME) {
        0
    } else {
        current
    };
    previous.saturating_add(1)
}

fn restart_delay(failures: u32) -> Duration {
    Duration::from_secs(2u64.saturating_pow(failures.min(6)).min(30))
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
                let started_at = Instant::now();
                let pid = child.id();
                *state.child_pid.lock().unwrap() = Some(pid);
                state.set_url(url.clone());

                // Point every existing window at the (new) backend. On the
                // first spawn there are no windows yet, so this is a no-op.
                for (_, window) in app.webview_windows() {
                    let _ = window.navigate(url.clone());
                }

                // Block until the backend exits (crash or quit-time kill).
                let exit_status = child.wait();
                state.mark_stopped();

                if state.quitting.load(Ordering::SeqCst) {
                    break;
                }

                let uptime = started_at.elapsed();
                if uptime >= STABLE_BACKEND_UPTIME {
                    error_reported = false;
                }
                failures = next_failure_count(failures, Some(uptime));
                let detail = match exit_status {
                    Ok(status) => format!("backend exited unexpectedly with {status}"),
                    Err(error) => format!("failed to wait for backend process: {error}"),
                };
                eprintln!("[harness] {detail} ({failures}); restarting");
                if failures >= MAX_RESTART_ATTEMPTS && !error_reported {
                    error_reported = true;
                    show_backend_error(&app, &detail);
                }
                std::thread::sleep(restart_delay(failures));
            }
            Err(e) => {
                failures = next_failure_count(failures, None);
                eprintln!("[harness] backend spawn failed ({failures}): {e}");
                if failures >= MAX_RESTART_ATTEMPTS && !error_reported {
                    error_reported = true;
                    show_backend_error(&app, &e);
                }
                std::thread::sleep(restart_delay(failures));
            }
        }
    }
    eprintln!("[harness] backend supervisor exiting");
}

/// Surface a native error dialog when the backend repeatedly fails.
fn show_backend_error(app: &tauri::AppHandle, err: &dyn std::fmt::Display) {
    let locale = native_locale(app);
    app.dialog()
        .message(match locale {
            NativeLocale::Zh => format!("OpenHarness 后端运行失败：{err}"),
            NativeLocale::En => format!("The OpenHarness backend failed: {err}"),
        })
        .title("OpenHarness")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

fn show_update_message(app: &AppHandle, message: impl Into<String>, kind: MessageDialogKind) {
    app.dialog()
        .message(message)
        .title("OpenHarness")
        .kind(kind)
        .show(|_| {});
}

fn update_menu_label(locale: NativeLocale, status: UpdateMenuStatus) -> String {
    match status {
        UpdateMenuStatus::Idle => locale
            .text("检查更新...", "Check for Updates...")
            .to_string(),
        UpdateMenuStatus::Checking => locale
            .text("正在检查更新...", "Checking for Updates...")
            .to_string(),
        UpdateMenuStatus::Downloading(Some(percent)) => match locale {
            NativeLocale::Zh => format!("正在下载更新... {percent}%"),
            NativeLocale::En => format!("Downloading Update... {percent}%"),
        },
        UpdateMenuStatus::Downloading(None) => locale
            .text("正在下载更新...", "Downloading Update...")
            .to_string(),
        UpdateMenuStatus::Installing => locale
            .text("正在安装更新...", "Installing Update...")
            .to_string(),
        UpdateMenuStatus::Restarting => locale.text("正在重启...", "Restarting...").to_string(),
    }
}

impl NativeUi {
    fn locale(&self) -> NativeLocale {
        *self.locale.lock().unwrap()
    }

    fn render_update_status(&self, enabled: bool) {
        let label = update_menu_label(self.locale(), *self.update_status.lock().unwrap());
        for item in [&self.app_menu.update, &self.tray_menu.update] {
            let _ = item.set_text(&label);
            let _ = item.set_enabled(enabled);
        }
    }

    fn set_update_status(&self, status: UpdateMenuStatus, enabled: bool) {
        *self.update_status.lock().unwrap() = status;
        self.render_update_status(enabled);
    }

    fn set_locale(&self, locale: NativeLocale, update_enabled: bool) {
        *self.locale.lock().unwrap() = locale;
        let _ = self
            .app_menu
            .about
            .set_text(locale.text("关于 OpenHarness", "About OpenHarness"));
        let _ = self
            .app_menu
            .services
            .set_text(locale.text("服务", "Services"));
        let _ = self
            .app_menu
            .hide
            .set_text(locale.text("隐藏 OpenHarness", "Hide OpenHarness"));
        let _ = self
            .app_menu
            .hide_others
            .set_text(locale.text("隐藏其他", "Hide Others"));
        let _ = self
            .app_menu
            .quit
            .set_text(locale.text("退出 OpenHarness", "Quit OpenHarness"));
        let _ = self
            .tray_menu
            .show
            .set_text(locale.text("显示主窗口", "Show Main Window"));
        let _ = self
            .tray_menu
            .new
            .set_text(locale.text("新建窗口", "New Window"));
        let _ = self.tray_menu.quit.set_text(locale.text("退出", "Quit"));
        self.render_update_status(update_enabled);
    }
}

fn native_locale(app: &AppHandle) -> NativeLocale {
    app.try_state::<AppUpdateState>()
        .map(|state| state.ui.locale())
        .unwrap_or(NativeLocale::Zh)
}

#[tauri::command]
fn sync_dsh_preferences(app: AppHandle, theme: String, locale: String) -> Result<(), String> {
    let theme = match theme.as_str() {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        "system" => None,
        _ => return Err("unsupported DSH theme preference".to_string()),
    };
    let locale = NativeLocale::parse(&locale)
        .ok_or_else(|| "unsupported DSH locale preference".to_string())?;
    let should_check_for_updates = {
        let state = app
            .try_state::<AppUpdateState>()
            .ok_or_else(|| "native UI state is not ready".to_string())?;

        app.set_theme(theme);
        state
            .ui
            .set_locale(locale, !state.busy.load(Ordering::SeqCst));
        !state.automatic_check_started.swap(true, Ordering::SeqCst)
    };
    if should_check_for_updates {
        request_update_check(app, UpdateCheckSource::Automatic);
    }
    Ok(())
}

fn update_prompt(
    locale: NativeLocale,
    current_version: &str,
    new_version: &str,
    notes: Option<&str>,
) -> String {
    let notes = notes.map(str::trim).filter(|notes| !notes.is_empty());
    let notes = notes.map(|notes| {
        let mut chars = notes.chars();
        let truncated: String = chars.by_ref().take(UPDATE_NOTES_LIMIT).collect();
        if chars.next().is_some() {
            format!("{truncated}\n...")
        } else {
            truncated
        }
    });

    match (locale, notes) {
        (NativeLocale::Zh, Some(notes)) => format!(
            "发现 OpenHarness {new_version}（当前版本 {current_version}）。\n\n{notes}\n\n立即下载并安装吗？安装完成后应用会自动重启。"
        ),
        (NativeLocale::Zh, None) => format!(
            "发现 OpenHarness {new_version}（当前版本 {current_version}）。\n\n立即下载并安装吗？安装完成后应用会自动重启。"
        ),
        (NativeLocale::En, Some(notes)) => format!(
            "OpenHarness {new_version} is available (current version: {current_version}).\n\n{notes}\n\nDownload and install it now? The app will restart automatically after installation."
        ),
        (NativeLocale::En, None) => format!(
            "OpenHarness {new_version} is available (current version: {current_version}).\n\nDownload and install it now? The app will restart automatically after installation."
        ),
    }
}

fn download_percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|total| *total > 0)?;
    Some(((downloaded.saturating_mul(100) / total).min(100)) as u8)
}

fn parse_build_number(value: &str) -> Result<Vec<u64>, String> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.is_empty() || parts.len() > 3 {
        return Err(format!("invalid build number {value}"));
    }
    parts
        .into_iter()
        .map(|part| {
            if part.is_empty()
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
            {
                return Err(format!("invalid build number {value}"));
            }
            part.parse::<u64>()
                .map_err(|error| format!("invalid build number {value}: {error}"))
        })
        .collect()
}

fn compare_build_numbers(left: &str, right: &str) -> Result<CompareOrdering, String> {
    let left = parse_build_number(left)?;
    let right = parse_build_number(right)?;
    let count = left.len().max(right.len());
    for index in 0..count {
        let ordering = left
            .get(index)
            .copied()
            .unwrap_or(0)
            .cmp(&right.get(index).copied().unwrap_or(0));
        if ordering != CompareOrdering::Equal {
            return Ok(ordering);
        }
    }
    Ok(CompareOrdering::Equal)
}

fn configured_build_number(value: Option<&str>) -> Result<String, String> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "application configuration is missing bundleVersion".to_string())?;
    let parts = parse_build_number(value)?;
    if parts.iter().all(|part| *part == 0) {
        return Err("application bundleVersion must be positive".to_string());
    }
    Ok(value.to_string())
}

fn compare_core_versions(left: &Version, right: &Version) -> CompareOrdering {
    (left.major, left.minor, left.patch).cmp(&(right.major, right.minor, right.patch))
}

fn is_remote_update_newer(
    current_version: &Version,
    current_build: &str,
    remote_version: &str,
    remote_build: &str,
) -> Result<bool, String> {
    let remote_version = Version::parse(remote_version)
        .map_err(|error| format!("invalid update version {remote_version}: {error}"))?;
    let build_ordering = compare_build_numbers(remote_build, current_build)?;
    match compare_core_versions(&remote_version, current_version) {
        CompareOrdering::Greater => Ok(true),
        CompareOrdering::Less => Ok(false),
        CompareOrdering::Equal => Ok(build_ordering == CompareOrdering::Greater),
    }
}

fn manifest_build_number(manifest: &serde_json::Value) -> Result<&str, String> {
    manifest
        .get("build_number")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "update manifest is missing build_number".to_string())
}

fn version_label(locale: NativeLocale, version: &str, build_number: &str) -> String {
    match locale {
        NativeLocale::Zh => format!("{version}，构建 {build_number}"),
        NativeLocale::En => format!("{version}, build {build_number}"),
    }
}

fn up_to_date_message(locale: NativeLocale, version: &str, build_number: &str) -> String {
    let version = version_label(locale, version, build_number);
    match locale {
        NativeLocale::Zh => format!("当前已是最新版本（{version}）。"),
        NativeLocale::En => format!("OpenHarness {version} is up to date."),
    }
}

fn finish_update_operation(app: &AppHandle) {
    let state = app.state::<AppUpdateState>();
    state.busy.store(false, Ordering::SeqCst);
    state.ui.set_update_status(UpdateMenuStatus::Idle, true);
}

fn request_update_check(app: AppHandle, source: UpdateCheckSource) {
    let locale = native_locale(&app);
    if cfg!(debug_assertions) {
        if source == UpdateCheckSource::Manual {
            show_update_message(
                &app,
                locale.text(
                    "开发构建不会检查或安装正式更新。",
                    "Development builds do not check for or install release updates.",
                ),
                MessageDialogKind::Info,
            );
        }
        return;
    }

    let state = app.state::<AppUpdateState>();
    if state.busy.swap(true, Ordering::SeqCst) {
        if source == UpdateCheckSource::Manual {
            show_update_message(
                &app,
                locale.text(
                    "更新检查或安装正在进行中。",
                    "An update check or installation is already in progress.",
                ),
                MessageDialogKind::Info,
            );
        }
        return;
    }
    state
        .ui
        .set_update_status(UpdateMenuStatus::Checking, false);

    tauri::async_runtime::spawn(async move {
        let current_version = app.package_info().version.clone();
        let current_build_number = match configured_build_number(
            app.config().bundle.macos.bundle_version.as_deref(),
        ) {
            Ok(build_number) => build_number,
            Err(error) => {
                eprintln!("[updater] {error}");
                if source == UpdateCheckSource::Manual {
                    show_update_message(
                            &app,
                            locale.text(
                                "应用构建号配置无效，无法检查更新。",
                                "The application build number is invalid, so updates cannot be checked.",
                            ),
                            MessageDialogKind::Error,
                        );
                }
                finish_update_operation(&app);
                return;
            }
        };
        let comparison_version = current_version.clone();
        let check_result = match app
            .updater_builder()
            .version_comparator(move |_package_version, release| {
                compare_core_versions(&release.version, &comparison_version)
                    != CompareOrdering::Less
            })
            .build()
        {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };

        let update = match check_result {
            Ok(Some(update)) => update,
            Ok(None) => {
                if source == UpdateCheckSource::Manual {
                    show_update_message(
                        &app,
                        up_to_date_message(
                            locale,
                            &current_version.to_string(),
                            &current_build_number,
                        ),
                        MessageDialogKind::Info,
                    );
                }
                finish_update_operation(&app);
                return;
            }
            Err(error) => {
                eprintln!("[updater] update check failed: {error}");
                if source == UpdateCheckSource::Manual {
                    show_update_message(
                        &app,
                        match locale {
                            NativeLocale::Zh => format!("检查更新失败：{error}"),
                            NativeLocale::En => format!("Failed to check for updates: {error}"),
                        },
                        MessageDialogKind::Error,
                    );
                }
                finish_update_operation(&app);
                return;
            }
        };

        let remote_build_number = match manifest_build_number(&update.raw_json) {
            Ok(build_number) => build_number,
            Err(error) => {
                eprintln!("[updater] {error}");
                if source == UpdateCheckSource::Manual {
                    show_update_message(
                        &app,
                        locale.text(
                            "更新清单缺少有效的构建号。",
                            "The update manifest does not contain a valid build number.",
                        ),
                        MessageDialogKind::Error,
                    );
                }
                finish_update_operation(&app);
                return;
            }
        };
        let is_newer = match is_remote_update_newer(
            &current_version,
            &current_build_number,
            &update.version,
            remote_build_number,
        ) {
            Ok(is_newer) => is_newer,
            Err(error) => {
                eprintln!("[updater] {error}");
                if source == UpdateCheckSource::Manual {
                    show_update_message(
                        &app,
                        locale.text(
                            "更新版本信息无效。",
                            "The update version information is invalid.",
                        ),
                        MessageDialogKind::Error,
                    );
                }
                finish_update_operation(&app);
                return;
            }
        };
        if !is_newer {
            if source == UpdateCheckSource::Manual {
                show_update_message(
                    &app,
                    up_to_date_message(locale, &current_version.to_string(), &current_build_number),
                    MessageDialogKind::Info,
                );
            }
            finish_update_operation(&app);
            return;
        }

        let prompt = update_prompt(
            locale,
            &version_label(locale, &current_version.to_string(), &current_build_number),
            &version_label(locale, &update.version, remote_build_number),
            update.body.as_deref(),
        );
        let dialog_app = app.clone();
        let accepted = tauri::async_runtime::spawn_blocking(move || {
            dialog_app
                .dialog()
                .message(prompt)
                .title(locale.text("OpenHarness 更新", "OpenHarness Update"))
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    locale.text("立即更新", "Update Now").to_string(),
                    locale.text("稍后", "Later").to_string(),
                ))
                .blocking_show()
        })
        .await
        .unwrap_or(false);

        if !accepted {
            finish_update_operation(&app);
            return;
        }

        let native_ui = app.state::<AppUpdateState>().ui.clone();
        native_ui.set_update_status(UpdateMenuStatus::Downloading(None), false);
        let mut downloaded = 0u64;
        let mut last_bucket = None;
        let install_result = update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded = downloaded.saturating_add(chunk_length as u64);
                    if let Some(percent) = download_percent(downloaded, content_length) {
                        let bucket = percent / 5;
                        if last_bucket != Some(bucket) {
                            last_bucket = Some(bucket);
                            native_ui.set_update_status(
                                UpdateMenuStatus::Downloading(Some(percent)),
                                false,
                            );
                        }
                    }
                },
                || {
                    native_ui.set_update_status(UpdateMenuStatus::Installing, false);
                },
            )
            .await;

        match install_result {
            Ok(()) => {
                native_ui.set_update_status(UpdateMenuStatus::Restarting, false);
                app.restart();
            }
            Err(error) => {
                eprintln!("[updater] update installation failed: {error}");
                show_update_message(
                    &app,
                    match locale {
                        NativeLocale::Zh => format!("更新安装失败：{error}"),
                        NativeLocale::En => format!("Failed to install the update: {error}"),
                    },
                    MessageDialogKind::Error,
                );
                finish_update_operation(&app);
            }
        }
    });
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
        // Wry's macOS acceptsFirstMouse override preserves the activation click.
        .accept_first_mouse(true)
        .initialization_script(WEBVIEW_INIT_SCRIPT)
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

/// Build the macOS application menu with the native About panel and update command.
fn build_app_menu(
    app: &AppHandle,
    locale: NativeLocale,
) -> tauri::Result<(Menu<Wry>, AppMenuItems)> {
    let package = app.package_info();
    let about = PredefinedMenuItem::about(
        app,
        Some(locale.text("关于 OpenHarness", "About OpenHarness")),
        None,
    )?;
    let update = MenuItem::with_id(
        app,
        APP_UPDATE_MENU_ID,
        update_menu_label(locale, UpdateMenuStatus::Idle),
        true,
        None::<&str>,
    )?;
    let services = PredefinedMenuItem::services(app, Some(locale.text("服务", "Services")))?;
    let hide = PredefinedMenuItem::hide(
        app,
        Some(locale.text("隐藏 OpenHarness", "Hide OpenHarness")),
    )?;
    let hide_others =
        PredefinedMenuItem::hide_others(app, Some(locale.text("隐藏其他", "Hide Others")))?;
    let quit = PredefinedMenuItem::quit(
        app,
        Some(locale.text("退出 OpenHarness", "Quit OpenHarness")),
    )?;
    let app_menu = Submenu::with_items(
        app,
        package.name.clone(),
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &update,
            &PredefinedMenuItem::separator(app)?,
            &services,
            &PredefinedMenuItem::separator(app)?,
            &hide,
            &hide_others,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let menu = Menu::default(app)?;
    menu.remove_at(0)?
        .ok_or_else(|| std::io::Error::other("default application menu is missing"))?;
    menu.prepend(&app_menu)?;
    Ok((
        menu,
        AppMenuItems {
            about,
            update,
            services,
            hide,
            hide_others,
            quit,
        },
    ))
}

/// Build the menu-bar (tray) icon and its menu.
fn build_tray(app: &tauri::AppHandle, locale: NativeLocale) -> tauri::Result<TrayMenuItems> {
    let show = MenuItem::with_id(
        app,
        "show",
        locale.text("显示主窗口", "Show Main Window"),
        true,
        None::<&str>,
    )?;
    let new = MenuItem::with_id(
        app,
        "new",
        locale.text("新建窗口", "New Window"),
        true,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(
        app,
        "update",
        update_menu_label(locale, UpdateMenuStatus::Idle),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", locale.text("退出", "Quit"), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new, &update, &quit])?;

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
            "update" => request_update_check(app.clone(), UpdateCheckSource::Manual),
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
    Ok(TrayMenuItems {
        show,
        new,
        update,
        quit,
    })
}

fn main() {
    let initial_locale = preferred_native_locale();
    let app_menu_slot = Arc::new(Mutex::new(None::<AppMenuItems>));
    let menu_slot = app_menu_slot.clone();
    let setup_slot = app_menu_slot;

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch was requested: re-focus the existing instance.
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![sync_dsh_preferences])
        .menu(move |app| {
            let (menu, items) = build_app_menu(app, initial_locale)?;
            *menu_slot.lock().unwrap() = Some(items);
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id.as_ref() == APP_UPDATE_MENU_ID {
                request_update_check(app.clone(), UpdateCheckSource::Manual);
            }
        })
        .setup(move |app| {
            install_native_context_menu_filter();

            let resource_dir = app.path().resource_dir()?;
            let home = app.path().home_dir()?;
            let state = Arc::new(BackendState::new());
            app.manage(state.clone());

            let app_menu = setup_slot
                .lock()
                .unwrap()
                .take()
                .ok_or_else(|| std::io::Error::other("application menu items are missing"))?;
            let tray_menu = build_tray(app.handle(), initial_locale)?;
            let ui = NativeUi {
                locale: Arc::new(Mutex::new(initial_locale)),
                update_status: Arc::new(Mutex::new(UpdateMenuStatus::Idle)),
                app_menu,
                tray_menu,
            };
            ui.set_locale(initial_locale, true);
            app.manage(AppUpdateState {
                busy: AtomicBool::new(false),
                automatic_check_started: AtomicBool::new(false),
                ui,
            });

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

    #[test]
    fn failure_streak_resets_only_after_stable_uptime() {
        assert_eq!(next_failure_count(2, None), 3);
        assert_eq!(next_failure_count(2, Some(Duration::from_secs(29))), 3);
        assert_eq!(next_failure_count(2, Some(STABLE_BACKEND_UPTIME)), 1);
        assert_eq!(next_failure_count(u32::MAX, None), u32::MAX);
    }

    #[test]
    fn restart_delay_is_exponential_and_capped() {
        assert_eq!(restart_delay(1), Duration::from_secs(2));
        assert_eq!(restart_delay(3), Duration::from_secs(8));
        assert_eq!(restart_delay(6), Duration::from_secs(30));
        assert_eq!(restart_delay(u32::MAX), Duration::from_secs(30));
    }

    #[test]
    fn backend_state_is_cleared_while_restarting() {
        let state = BackendState::new();
        *state.child_pid.lock().unwrap() = Some(42);
        state.set_url(Url::parse("http://127.0.0.1:3080").unwrap());
        assert_eq!(*state.child_pid.lock().unwrap(), Some(42));
        assert!(state.current_url().is_some());

        state.mark_stopped();

        assert_eq!(*state.child_pid.lock().unwrap(), None);
        assert!(state.current_url().is_none());
    }

    #[test]
    fn parses_only_supported_dsh_locales() {
        assert!(matches!(NativeLocale::parse("zh"), Some(NativeLocale::Zh)));
        assert!(matches!(NativeLocale::parse("en"), Some(NativeLocale::En)));
        assert!(NativeLocale::parse("zh-CN").is_none());
        assert!(NativeLocale::parse("fr").is_none());
    }

    #[test]
    fn localizes_native_update_menu_status() {
        assert_eq!(
            update_menu_label(NativeLocale::Zh, UpdateMenuStatus::Idle),
            "检查更新..."
        );
        assert_eq!(
            update_menu_label(NativeLocale::En, UpdateMenuStatus::Downloading(Some(42))),
            "Downloading Update... 42%"
        );
    }

    #[test]
    fn update_prompt_includes_versions_and_truncates_long_notes() {
        let notes = "a".repeat(UPDATE_NOTES_LIMIT + 1);
        let prompt = update_prompt(
            NativeLocale::Zh,
            "0.1.0，构建 41",
            "0.1.0，构建 42",
            Some(&notes),
        );

        assert!(prompt.contains("构建 41"));
        assert!(prompt.contains("构建 42"));
        assert!(prompt.contains("\n...\n"));
        assert!(!prompt.contains(&notes));
    }

    #[test]
    fn download_percent_handles_unknown_empty_and_overrun_sizes() {
        assert_eq!(download_percent(50, Some(100)), Some(50));
        assert_eq!(download_percent(120, Some(100)), Some(100));
        assert_eq!(download_percent(50, Some(0)), None);
        assert_eq!(download_percent(50, None), None);
    }

    #[test]
    fn update_versions_compare_version_before_build_number() {
        let current_version = Version::parse("0.1.0").unwrap();

        assert!(is_remote_update_newer(&current_version, "41", "0.1.0-beta.2", "42").unwrap());
        assert!(is_remote_update_newer(&current_version, "42", "0.1.0-alpha.9", "43").unwrap());
        assert!(!is_remote_update_newer(&current_version, "42", "0.1.0-beta.3", "42").unwrap());
        assert!(is_remote_update_newer(&current_version, "99", "0.1.1-beta.0", "1").unwrap());
        assert!(!is_remote_update_newer(&current_version, "1", "0.0.9-beta.99", "999").unwrap());
        assert_eq!(
            compare_core_versions(
                &Version::parse("0.1.0-alpha.1").unwrap(),
                &Version::parse("0.1.0-beta.99").unwrap()
            ),
            CompareOrdering::Equal
        );
        assert_eq!(
            compare_build_numbers("1.10", "1.2").unwrap(),
            CompareOrdering::Greater
        );
        assert_eq!(
            compare_build_numbers("1", "1.0").unwrap(),
            CompareOrdering::Equal
        );
    }

    #[test]
    fn requires_a_positive_configured_build_number() {
        assert_eq!(configured_build_number(Some("7")).unwrap(), "7");
        assert!(configured_build_number(None).is_err());
        assert!(configured_build_number(Some("0")).is_err());
        assert!(configured_build_number(Some("01")).is_err());
    }
}
