use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const DSH_PACKAGE_NAME: &str = "@deepseek-ai/dsh";
const DSH_VERSION_PLACEHOLDER: &str = "{{DSH_VERSION}}";

fn dsh_version(runtime_manifest_path: &Path) -> String {
    let manifest = fs::read_to_string(runtime_manifest_path)
        .unwrap_or_else(|error| panic!("failed to read runtime package manifest: {error}"));
    let manifest: serde_json::Value = serde_json::from_str(&manifest)
        .unwrap_or_else(|error| panic!("invalid runtime package manifest: {error}"));
    let version = manifest
        .get("dependencies")
        .and_then(|dependencies| dependencies.get(DSH_PACKAGE_NAME))
        .and_then(serde_json::Value::as_str)
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| panic!("runtime package manifest is missing {DSH_PACKAGE_NAME}"));

    semver::Version::parse(version)
        .unwrap_or_else(|error| panic!("invalid {DSH_PACKAGE_NAME} version {version}: {error}"));
    version.to_owned()
}

fn generate_credits(manifest_dir: &Path) {
    let runtime_manifest_path = manifest_dir.join("../runtime/package.json");
    let template_path = manifest_dir.join("Credits.template.html");
    let output_path = manifest_dir.join("target/generated/Credits.html");

    println!("cargo:rerun-if-changed={}", runtime_manifest_path.display());
    println!("cargo:rerun-if-changed={}", template_path.display());
    println!("cargo:rerun-if-changed={}", output_path.display());

    let template = fs::read_to_string(&template_path)
        .unwrap_or_else(|error| panic!("failed to read Credits template: {error}"));
    assert_eq!(
        template.matches(DSH_VERSION_PLACEHOLDER).count(),
        1,
        "Credits template must contain exactly one {DSH_VERSION_PLACEHOLDER} placeholder"
    );
    let credits = template.replace(
        DSH_VERSION_PLACEHOLDER,
        &dsh_version(&runtime_manifest_path),
    );

    if fs::read_to_string(&output_path).ok().as_deref() != Some(credits.as_str()) {
        fs::create_dir_all(
            output_path
                .parent()
                .expect("generated Credits path has no parent directory"),
        )
        .unwrap_or_else(|error| panic!("failed to create generated Credits directory: {error}"));
        fs::write(&output_path, credits)
            .unwrap_or_else(|error| panic!("failed to generate Credits.html: {error}"));
    }
}

#[cfg(target_os = "macos")]
fn compile_native_context_menu(manifest_dir: &Path) {
    let source = manifest_dir.join("src/native_context_menu.m");
    println!("cargo:rerun-if-changed={}", source.display());

    cc::Build::new()
        .file(source)
        .flag("-fobjc-arc")
        .compile("openharness_native_context_menu");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=WebKit");
}

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is unavailable"));
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("runtime").display()
    );
    generate_credits(&manifest_dir);
    #[cfg(target_os = "macos")]
    compile_native_context_menu(&manifest_dir);

    println!("cargo:rerun-if-env-changed=OPENHARNESS_BUILD_NUMBER");
    if let Ok(build_number) = env::var("OPENHARNESS_BUILD_NUMBER") {
        println!("cargo:rustc-env=OPENHARNESS_BUILD_NUMBER={build_number}");
    }

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["sync_dsh_preferences", "sync_dsh_sessions"]),
    ))
    .expect("failed to build Tauri application metadata")
}
