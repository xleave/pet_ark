use base64::Engine;
use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

const SERVICE: &str = "pet-ark.service";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RuntimeStatus {
    ok: bool,
    pid: u32,
    character: String,
    variant: String,
    scale: f32,
    speed: f32,
    auto_move: bool,
    click_through: bool,
    monitor: u32,
    outputs: u32,
    shell: String,
    behavior: String,
    animation: String,
}

#[derive(Debug, Clone, Serialize)]
struct ServiceStatus {
    installed: bool,
    active: bool,
    state: String,
    sub_state: String,
    pid: u32,
    restarts: u32,
    autostart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RuntimeConfig {
    character: String,
    variant: String,
    scale: f32,
    speed: f32,
    auto_move: bool,
    click_through: bool,
    monitor: u32,
    verbose: bool,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            character: "amiya".into(),
            variant: "default".into(),
            scale: 1.0,
            speed: 1.0,
            auto_move: true,
            click_through: false,
            monitor: 0,
            verbose: true,
        }
    }
}

#[derive(Debug, Deserialize)]
struct Registry {
    characters: Vec<RegistryCharacter>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RegistryCharacter {
    id: String,
    name: String,
    localized_name: String,
    default_variant_id: String,
    variants: Vec<RegistryVariant>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RegistryVariant {
    id: String,
    name: String,
    localized_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct LogEntry {
    cursor: String,
    timestamp: String,
    priority: u8,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct PreviewAsset {
    data_url: String,
    frame_width: u32,
    frame_height: u32,
    columns: u32,
    rows: u32,
    frames: Vec<u32>,
    fps: u32,
}

fn home_dir() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is unavailable".into())
}

fn config_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".config/pet-ark/runtime.env"))
}

fn socket_path() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("PET_ARK_CONTROL_SOCKET") {
        return Ok(path.into());
    }
    env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .map(|path| path.join("pet-ark/control.sock"))
        .ok_or_else(|| "XDG_RUNTIME_DIR is unavailable".into())
}

fn registry_path() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("PET_ARK_REGISTRY") {
        candidates.push(PathBuf::from(path));
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("../../standalone/dist/app/characters/registry.json"));
    candidates.push(manifest.join("../../standalone/characters/registry.json"));
    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("../characters/registry.json"));
            candidates.push(parent.join("../share/pet-ark/characters/registry.json"));
            candidates.push(parent.join("characters/registry.json"));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "Pet Ark character registry was not found".into())
}

fn runtime_variant_path(character: &str, variant: &str) -> Result<PathBuf, String> {
    if !valid_id(character) || !valid_id(variant) {
        return Err("invalid preview identity".into());
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = vec![
        manifest
            .join("../../standalone/dist/app/assets/runtime")
            .join(character)
            .join(variant),
        manifest
            .join("../../standalone/assets/runtime")
            .join(character)
            .join(variant),
    ];
    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.insert(
                0,
                parent
                    .join("../assets/runtime")
                    .join(character)
                    .join(variant),
            );
        }
    }
    if let Some(root) = env::var_os("PET_ARK_ASSETS") {
        candidates.insert(0, PathBuf::from(root).join(character).join(variant));
    }
    candidates
        .into_iter()
        .find(|path| path.join("manifest.json").is_file())
        .ok_or_else(|| "preview assets were not found".into())
}

fn load_registry() -> Result<Registry, String> {
    let path = registry_path()?;
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    serde_json::from_str(&contents).map_err(|error| format!("invalid character registry: {error}"))
}

fn systemctl(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map_err(|error| format!("cannot run systemctl: {error}"))
}

fn output_error(label: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if stderr.is_empty() {
        format!("{label} failed with status {}", output.status)
    } else {
        stderr
    }
}

fn parse_properties(text: &str) -> std::collections::HashMap<&str, &str> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .collect()
}

#[tauri::command]
fn service_status() -> Result<ServiceStatus, String> {
    let output = systemctl(&[
        "show",
        SERVICE,
        "--property=LoadState,ActiveState,SubState,MainPID,NRestarts,UnitFileState",
    ])?;
    let text = String::from_utf8_lossy(&output.stdout);
    let values = parse_properties(&text);
    let installed = values.get("LoadState").copied().unwrap_or("not-found") != "not-found";
    let unit_state = values.get("UnitFileState").copied().unwrap_or("disabled");
    Ok(ServiceStatus {
        installed,
        active: values.get("ActiveState").copied() == Some("active"),
        state: values
            .get("ActiveState")
            .copied()
            .unwrap_or("unknown")
            .into(),
        sub_state: values.get("SubState").copied().unwrap_or("unknown").into(),
        pid: values
            .get("MainPID")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        restarts: values
            .get("NRestarts")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        autostart: matches!(
            unit_state,
            "enabled" | "enabled-runtime" | "linked" | "linked-runtime"
        ),
    })
}

#[tauri::command]
fn service_action(action: String) -> Result<ServiceStatus, String> {
    if !matches!(action.as_str(), "start" | "stop" | "restart") {
        return Err("unsupported service action".into());
    }
    let output = systemctl(&[&action, SERVICE])?;
    if !output.status.success() {
        return Err(output_error("service action", &output));
    }
    service_status()
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<ServiceStatus, String> {
    let action = if enabled { "enable" } else { "disable" };
    let output = systemctl(&[action, SERVICE])?;
    if !output.status.success() {
        return Err(output_error("autostart update", &output));
    }
    service_status()
}

fn send_control(value: Value) -> Result<RuntimeStatus, String> {
    let path = socket_path()?;
    let mut stream = UnixStream::connect(&path)
        .map_err(|error| format!("cannot connect to {}: {error}", path.display()))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    let payload = format!("{}\n", value);
    stream
        .write_all(payload.as_bytes())
        .map_err(|error| format!("control write failed: {error}"))?;
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(|error| format!("control shutdown failed: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("control read failed: {error}"))?;
    let json: Value = serde_json::from_str(&response)
        .map_err(|error| format!("invalid runtime response: {error}"))?;
    if json.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(json
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("runtime rejected the command")
            .into());
    }
    serde_json::from_value(json).map_err(|error| format!("invalid runtime status: {error}"))
}

#[tauri::command]
fn runtime_status() -> Result<RuntimeStatus, String> {
    send_control(json!({ "command": "get_status" }))
}

fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

#[tauri::command]
fn load_config() -> Result<RuntimeConfig, String> {
    let path = config_path()?;
    let Ok(contents) = fs::read_to_string(path) else {
        return Ok(RuntimeConfig::default());
    };
    let mut config = RuntimeConfig::default();
    for line in contents.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "PET_ARK_CHARACTER" => config.character = value.trim().into(),
            "PET_ARK_VARIANT" => config.variant = value.trim().into(),
            "PET_ARK_SCALE" => config.scale = value.trim().parse().unwrap_or(config.scale),
            "PET_ARK_SPEED" => config.speed = value.trim().parse().unwrap_or(config.speed),
            "PET_ARK_AUTO_MOVE" => {
                config.auto_move = parse_bool(value.trim()).unwrap_or(config.auto_move)
            }
            "PET_ARK_CLICK_THROUGH" => {
                config.click_through = parse_bool(value.trim()).unwrap_or(config.click_through)
            }
            "PET_ARK_MONITOR" => config.monitor = value.trim().parse().unwrap_or(config.monitor),
            "PET_ARK_VERBOSE" => {
                config.verbose = parse_bool(value.trim()).unwrap_or(config.verbose)
            }
            _ => {}
        }
    }
    Ok(config)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() < 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn validate_config(config: &RuntimeConfig) -> Result<(), String> {
    if !valid_id(&config.character) || !valid_id(&config.variant) {
        return Err("character or variant id is invalid".into());
    }
    if !(0.25..=3.0).contains(&config.scale) {
        return Err("scale must be between 0.25 and 3.0".into());
    }
    if !(0.1..=5.0).contains(&config.speed) {
        return Err("speed must be between 0.1 and 5.0".into());
    }
    if config.monitor > 15 {
        return Err("monitor must be between 0 and 15".into());
    }
    let registry = load_registry()?;
    let character = registry
        .characters
        .iter()
        .find(|entry| entry.id == config.character)
        .ok_or_else(|| "selected character is not registered".to_string())?;
    if !character
        .variants
        .iter()
        .any(|variant| variant.id == config.variant)
    {
        return Err("selected variant is not registered for this character".into());
    }
    Ok(())
}

fn write_config(config: &RuntimeConfig) -> Result<(), String> {
    let path = config_path()?;
    validate_config(config)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create config directory: {error}"))?;
    }
    let contents = format!(
        "PET_ARK_CHARACTER={}\nPET_ARK_VARIANT={}\nPET_ARK_SCALE={}\nPET_ARK_SPEED={}\n\
PET_ARK_AUTO_MOVE={}\nPET_ARK_CLICK_THROUGH={}\nPET_ARK_MONITOR={}\nPET_ARK_VERBOSE={}\n",
        config.character,
        config.variant,
        config.scale,
        config.speed,
        config.auto_move,
        config.click_through,
        config.monitor,
        config.verbose,
    );
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|error| format!("cannot write config: {error}"))?;
    file.write_all(contents.as_bytes())
        .map_err(|error| format!("cannot write config: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("cannot sync config: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| format!("cannot replace config: {error}"))
}

#[tauri::command]
fn save_config(config: RuntimeConfig, restart: bool) -> Result<Option<RuntimeStatus>, String> {
    write_config(&config)?;
    if restart {
        service_action("restart".into())?;
        std::thread::sleep(Duration::from_millis(350));
        return Ok(runtime_status().ok());
    }
    if !service_status()?.active {
        return Ok(None);
    }
    send_control(
        json!({ "command": "select", "character": config.character, "variant": config.variant }),
    )?;
    send_control(json!({ "command": "set_scale", "value": config.scale }))?;
    send_control(json!({ "command": "set_speed", "value": config.speed }))?;
    send_control(json!({ "command": "set_auto_move", "value": config.auto_move }))?;
    let status =
        send_control(json!({ "command": "set_click_through", "value": config.click_through }))?;
    Ok(Some(status))
}

#[tauri::command]
fn list_characters() -> Result<Vec<RegistryCharacter>, String> {
    let mut characters = load_registry()?.characters;
    characters.sort_by(|left, right| {
        if left.id == "amiya" && right.id != "amiya" {
            return std::cmp::Ordering::Less;
        }
        if right.id == "amiya" && left.id != "amiya" {
            return std::cmp::Ordering::Greater;
        }
        left.localized_name.cmp(&right.localized_name)
    });
    Ok(characters)
}

#[tauri::command]
fn preview_asset(character: String, variant: String) -> Result<PreviewAsset, String> {
    let root = runtime_variant_path(&character, &variant)?;
    let manifest_path = root.join("manifest.json");
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(&manifest_path)
            .map_err(|error| format!("cannot read preview manifest: {error}"))?,
    )
    .map_err(|error| format!("invalid preview manifest: {error}"))?;
    let frame_width = manifest
        .pointer("/frameSize/width")
        .and_then(Value::as_u64)
        .unwrap_or(192) as u32;
    let frame_height = manifest
        .pointer("/frameSize/height")
        .and_then(Value::as_u64)
        .unwrap_or(224) as u32;
    let idle = manifest
        .pointer("/animations/idle")
        .ok_or_else(|| "idle animation is unavailable".to_string())?;
    let source_id = idle
        .get("source")
        .and_then(Value::as_str)
        .ok_or_else(|| "idle source is unavailable".to_string())?;
    let source = manifest
        .pointer(&format!("/sources/{source_id}"))
        .ok_or_else(|| "idle source metadata is unavailable".to_string())?;
    let sheet = idle
        .get("sheet")
        .and_then(Value::as_str)
        .or_else(|| source.get("sheet").and_then(Value::as_str))
        .ok_or_else(|| "idle spritesheet is unavailable".to_string())?;
    if sheet.contains('/') || sheet.contains('\\') {
        return Err("invalid preview sheet path".into());
    }
    let bytes = fs::read(root.join(sheet))
        .map_err(|error| format!("cannot read preview sheet: {error}"))?;
    let frames = idle
        .get("frameOrder")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_u64)
                .map(|value| value as u32)
                .collect()
        })
        .unwrap_or_else(|| vec![0]);
    Ok(PreviewAsset {
        data_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        frame_width,
        frame_height,
        columns: source.get("columns").and_then(Value::as_u64).unwrap_or(1) as u32,
        rows: source.get("rows").and_then(Value::as_u64).unwrap_or(1) as u32,
        frames,
        fps: idle.get("fps").and_then(Value::as_u64).unwrap_or(12) as u32,
    })
}

fn journal_timestamp(value: &Value) -> String {
    let micros = value
        .get("__REALTIME_TIMESTAMP")
        .and_then(Value::as_str)
        .and_then(|text| text.parse::<i64>().ok());
    let Some(micros) = micros else {
        return "—".into();
    };
    let Some(utc): Option<DateTime<Utc>> = DateTime::from_timestamp_micros(micros) else {
        return "—".into();
    };
    utc.with_timezone(&Local)
        .format("%m-%d %H:%M:%S%.3f")
        .to_string()
}

#[tauri::command]
fn read_logs(limit: usize) -> Result<Vec<LogEntry>, String> {
    let count = limit.clamp(20, 300).to_string();
    let output = Command::new("journalctl")
        .args([
            "--user",
            "-u",
            SERVICE,
            "--no-pager",
            "-n",
            &count,
            "-o",
            "json",
        ])
        .output()
        .map_err(|error| format!("cannot run journalctl: {error}"))?;
    if !output.status.success() {
        return Err(output_error("log query", &output));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .map(|value| LogEntry {
            cursor: value
                .get("__CURSOR")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
            timestamp: journal_timestamp(&value),
            priority: value
                .get("PRIORITY")
                .and_then(Value::as_str)
                .and_then(|text| text.parse().ok())
                .unwrap_or(6),
            message: value
                .get("MESSAGE")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
        })
        .collect())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            service_status,
            service_action,
            set_autostart,
            runtime_status,
            load_config,
            save_config,
            list_characters,
            preview_asset,
            read_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pet Ark Control Center");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_exposes_amiya_and_default_variant() {
        let registry = load_registry().expect("registry should load");
        let amiya = registry
            .characters
            .iter()
            .find(|entry| entry.id == "amiya")
            .expect("Amiya should be registered");
        assert!(amiya.variants.iter().any(|variant| variant.id == "default"));
    }

    #[test]
    fn default_configuration_is_valid() {
        validate_config(&RuntimeConfig::default()).expect("default config should be valid");
    }

    #[test]
    fn preview_uses_a_traceable_runtime_sheet() {
        let preview =
            preview_asset("amiya".into(), "default".into()).expect("Amiya preview should load");
        assert!(preview.data_url.starts_with("data:image/png;base64,"));
        assert!(preview.frame_width > 0 && preview.frame_height > 0);
        assert!(!preview.frames.is_empty());
        assert!(preview.fps > 0);
    }

    #[test]
    fn identifiers_reject_paths_and_shell_syntax() {
        assert!(valid_id("skin-winter-1"));
        assert!(!valid_id("../amiya"));
        assert!(!valid_id("amiya;restart"));
        assert!(!valid_id(""));
    }
}
