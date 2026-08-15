//! DeepSeek Harness desktop shell.
//!
//! Spawns the bundled `dsh web` server as a child process, waits for it to
//! report its canonical loopback URL, then hosts that browser UI in a native
//! window. The bundled Node runtime and `@deepseek-ai/dsh` node_modules live
//! under the app's resource directory (`runtime/**` in tauri.conf.json).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use url::Url;

/// How long to wait for the DSH server to print its URL before giving up.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

struct DshState {
    child: Mutex<Option<Child>>,
}

/// Extract the URL from the `dsh web: http://127.0.0.1:PORT` boot line.
fn parse_url(line: &str) -> Option<Url> {
    const MARKER: &str = "dsh web: ";
    let rest = line.find(MARKER).map(|i| &line[i + MARKER.len()..])?;
    let candidate = rest.split_whitespace().next()?;
    Url::parse(candidate).ok()
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
fn spawn_dsh(resource_dir: &Path, home: &Path) -> Result<(Child, Url), Box<dyn std::error::Error>> {
    let (node, bin) = resolve_runtime(resource_dir)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;

    let mut child = Command::new(node)
        .arg(bin)
        .args(["web", "--port", "0"])
        // Keep the bundled rc runtime aligned with upstream's current
        // default-off telemetry policy.
        .env("DSH_TELEMETRY_DISABLED", "1")
        .current_dir(home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("failed to spawn dsh: {e}"),
            )
        })?;

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

    let mut reader = BufReader::new(stdout);
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end();
                if !trimmed.is_empty() {
                    eprintln!("[dsh] {trimmed}");
                }
                if let Some(url) = parse_url(trimmed) {
                    return Ok((child, url));
                }
            }
            Err(_) => break,
        }
        if Instant::now() > deadline {
            break;
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "timed out waiting for the dsh web server to report its URL",
    )
    .into())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let home = app.path().home_dir()?;

            let (child, url) = spawn_dsh(&resource_dir, &home)?;
            app.manage(DshState {
                child: Mutex::new(Some(child)),
            });

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("DeepSeek Harness")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building DeepSeek Harness desktop app")
        .run(|app_handle, event| match event {
            RunEvent::Exit => {
                if let Some(state) = app_handle.try_state::<DshState>() {
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
