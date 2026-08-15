//! Native desktop host for OpenHarness.
//!
//! Spawns the bundled `dsh web` server as a child process, waits for it to
//! report its canonical loopback URL, then hosts that browser UI in a native
//! window. The bundled Node runtime and `@deepseek-ai/dsh` node_modules live
//! under the app's resource directory (`runtime/**` in tauri.conf.json).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use url::{Host, Url};

/// How long to wait for the DSH server to print its URL before giving up.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

struct HarnessState {
    child: Mutex<Option<Child>>,
}

/// Extract the URL from the `dsh web: http://127.0.0.1:PORT` boot line.
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

/// Spawn the DSH web server and block until it reports its canonical URL.
fn spawn_harness(
    resource_dir: &Path,
    home: &Path,
) -> Result<(Child, Url), Box<dyn std::error::Error>> {
    let (node, bin) = resolve_runtime(resource_dir)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;

    let mut child = Command::new(node)
        .arg(bin)
        .args(["web", "--port", "0"])
        .env("DSH_TELEMETRY_DISABLED", "1")
        .current_dir(home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let home = app.path().home_dir()?;

            let (child, url) = spawn_harness(&resource_dir, &home)?;
            app.manage(HarnessState {
                child: Mutex::new(Some(child)),
            });

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("OpenHarness")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OpenHarness app")
        .run(|app_handle, event| match event {
            RunEvent::Exit => {
                if let Some(state) = app_handle.try_state::<HarnessState>() {
                    if let Some(mut child) = state.child.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
            RunEvent::WindowEvent {
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                // macOS keeps the process alive after the last window closes;
                // quit so the dsh child is torn down too.
                app_handle.exit(0);
            }
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
