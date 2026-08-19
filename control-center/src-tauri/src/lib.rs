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
    #[serde(default)]
    instance: String,
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
    #[serde(default)]
    x: f32,
    #[serde(default)]
    y: f32,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    surface_width: u32,
    #[serde(default)]
    surface_height: u32,
    #[serde(default = "default_direction")]
    direction: i32,
    #[serde(default)]
    pointer_inside: bool,
    #[serde(default)]
    pointer_x: f32,
    #[serde(default)]
    pointer_y: f32,
}

fn default_direction() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize)]
struct PetInstance {
    id: String,
    character: String,
    variant: String,
    active: bool,
    pid: u32,
    autostart: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AiProviderConfig {
    kind: String,
    endpoint: String,
    model: String,
    api_key_env: String,
    timeout_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersonalityConfig {
    archetype: String,
    sociability: f32,
    curiosity: f32,
    energy: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrivacyConfig {
    include_app_id: bool,
    include_window_title: bool,
    include_workspace_name: bool,
    persist_timeline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BehaviorConfig {
    schema_version: u32,
    enabled: bool,
    provider: AiProviderConfig,
    interaction_intensity: f32,
    personality: PersonalityConfig,
    privacy: PrivacyConfig,
    behaviors: std::collections::BTreeMap<String, bool>,
    #[serde(default)]
    per_instance: Value,
}

impl Default for BehaviorConfig {
    fn default() -> Self {
        let behavior_keys = [
            "focus_greeting",
            "terminal_companion",
            "browser_curiosity",
            "media_quiet",
            "workspace_hop",
            "window_opened",
            "window_closed",
            "window_urgent",
            "overview_quiet",
            "pointer_greeting",
            "social_meeting",
            "collision_avoidance",
        ];
        Self {
            schema_version: 1,
            enabled: true,
            provider: AiProviderConfig {
                kind: "mock".into(),
                endpoint: "http://127.0.0.1:11434/v1".into(),
                model: String::new(),
                api_key_env: "OPENAI_API_KEY".into(),
                timeout_ms: 8000,
            },
            interaction_intensity: 0.65,
            personality: PersonalityConfig {
                archetype: "companion".into(),
                sociability: 0.72,
                curiosity: 0.68,
                energy: 0.58,
            },
            privacy: PrivacyConfig {
                include_app_id: true,
                include_window_title: false,
                include_workspace_name: false,
                persist_timeline: true,
            },
            behaviors: behavior_keys
                .into_iter()
                .map(|key| (key.into(), true))
                .collect(),
            per_instance: json!({}),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BehaviorEvent {
    timestamp: u64,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    speech: Option<String>,
    #[serde(default)]
    provider: Option<String>,
}

fn home_dir() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is unavailable".into())
}

fn config_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".config/pet-ark/runtime.env"))
}

fn behavior_config_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".config/pet-ark/behavior.json"))
}

fn behavior_timeline_path() -> Result<PathBuf, String> {
    if let Some(root) = env::var_os("XDG_STATE_HOME") {
        return Ok(PathBuf::from(root).join("pet-ark/events.jsonl"));
    }
    Ok(home_dir()?.join(".local/state/pet-ark/events.jsonl"))
}

fn behavior_world_path() -> Result<PathBuf, String> {
    env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .map(|path| path.join("pet-ark/world.json"))
        .ok_or_else(|| "XDG_RUNTIME_DIR is unavailable".into())
}

fn instance_config_path(instance: &str) -> Result<PathBuf, String> {
    if instance == "default" {
        return config_path();
    }
    if !valid_id(instance) || instance == "control" {
        return Err("invalid instance id".into());
    }
    Ok(home_dir()?
        .join(".config/pet-ark/instances")
        .join(format!("{instance}.env")))
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

fn instance_socket_path(instance: &str) -> Result<PathBuf, String> {
    if !valid_id(instance) {
        return Err("invalid instance id".into());
    }
    if instance == "default" {
        return socket_path();
    }
    env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .map(|path| path.join("pet-ark").join(format!("{instance}.sock")))
        .ok_or_else(|| "XDG_RUNTIME_DIR is unavailable".into())
}

fn instance_unit(instance: &str) -> Result<String, String> {
    if !valid_id(instance) {
        return Err("invalid instance id".into());
    }
    Ok(if instance == "default" {
        SERVICE.into()
    } else {
        format!("pet-ark@{instance}.service")
    })
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

fn service_status_for(unit: &str) -> Result<ServiceStatus, String> {
    let output = systemctl(&[
        "show",
        unit,
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
fn service_status() -> Result<ServiceStatus, String> {
    service_status_for(SERVICE)
}

#[tauri::command]
fn instance_service_status(id: String) -> Result<ServiceStatus, String> {
    service_status_for(&instance_unit(&id)?)
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

fn send_control_to(instance: &str, value: Value) -> Result<RuntimeStatus, String> {
    let path = instance_socket_path(instance)?;
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

fn send_control(value: Value) -> Result<RuntimeStatus, String> {
    send_control_to("default", value)
}

#[tauri::command]
fn runtime_status() -> Result<RuntimeStatus, String> {
    send_control(json!({ "command": "get_status" }))
}

#[tauri::command]
fn instance_runtime_status(id: String) -> Result<RuntimeStatus, String> {
    send_control_to(&id, json!({ "command": "get_status" }))
}

fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn parse_config(contents: &str) -> RuntimeConfig {
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
    config
}

fn load_config_from(path: &PathBuf) -> RuntimeConfig {
    fs::read_to_string(path)
        .map(|contents| parse_config(&contents))
        .unwrap_or_default()
}

#[tauri::command]
fn load_config() -> Result<RuntimeConfig, String> {
    let path = config_path()?;
    Ok(load_config_from(&path))
}

#[tauri::command]
fn load_instance_config(id: String) -> Result<RuntimeConfig, String> {
    Ok(load_config_from(&instance_config_path(&id)?))
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

fn write_config_to(path: PathBuf, config: &RuntimeConfig) -> Result<(), String> {
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
    save_instance_config("default".into(), config, restart)
}

#[tauri::command]
fn save_instance_config(
    id: String,
    config: RuntimeConfig,
    restart: bool,
) -> Result<Option<RuntimeStatus>, String> {
    write_config_to(instance_config_path(&id)?, &config)?;
    if restart {
        let unit = instance_unit(&id)?;
        let output = systemctl(&["restart", &unit])?;
        if !output.status.success() {
            return Err(output_error("instance restart", &output));
        }
        std::thread::sleep(Duration::from_millis(350));
        return Ok(send_control_to(&id, json!({ "command": "get_status" })).ok());
    }
    if !service_status_for(&instance_unit(&id)?)?.active {
        return Ok(None);
    }
    send_control_to(
        &id,
        json!({ "command": "select", "character": config.character, "variant": config.variant }),
    )?;
    send_control_to(
        &id,
        json!({ "command": "set_scale", "value": config.scale }),
    )?;
    send_control_to(
        &id,
        json!({ "command": "set_speed", "value": config.speed }),
    )?;
    send_control_to(
        &id,
        json!({ "command": "set_auto_move", "value": config.auto_move }),
    )?;
    let status = send_control_to(
        &id,
        json!({ "command": "set_click_through", "value": config.click_through }),
    )?;
    Ok(Some(status))
}

#[tauri::command]
fn list_instances() -> Result<Vec<PetInstance>, String> {
    let mut instances = Vec::new();
    let default_config = load_config_from(&config_path()?);
    let default_status = service_status_for(SERVICE)?;
    instances.push(PetInstance {
        id: "default".into(),
        character: default_config.character,
        variant: default_config.variant,
        active: default_status.active,
        pid: default_status.pid,
        autostart: default_status.autostart,
    });
    let directory = home_dir()?.join(".config/pet-ark/instances");
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(instances),
        Err(error) => return Err(format!("cannot read instance directory: {error}")),
    };
    let mut ids: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("env") {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_owned();
            valid_id(&id).then_some(id)
        })
        .collect();
    ids.sort();
    for id in ids {
        let config = load_config_from(&instance_config_path(&id)?);
        let status = service_status_for(&instance_unit(&id)?)?;
        instances.push(PetInstance {
            id,
            character: config.character,
            variant: config.variant,
            active: status.active,
            pid: status.pid,
            autostart: status.autostart,
        });
    }
    Ok(instances)
}

#[tauri::command]
fn create_instance(
    id: String,
    character: String,
    variant: String,
) -> Result<Vec<PetInstance>, String> {
    if !valid_id(&id) || matches!(id.as_str(), "default" | "control") {
        return Err("实例 ID 只能使用字母、数字、点、下划线和连字符".into());
    }
    if list_instances()?.len() >= 8 {
        return Err("当前版本最多同时管理 8 个桌宠实例".into());
    }
    let path = instance_config_path(&id)?;
    if path.exists() {
        return Err("该实例 ID 已存在".into());
    }
    let config = RuntimeConfig {
        character,
        variant,
        ..RuntimeConfig::default()
    };
    write_config_to(path, &config)?;
    let unit = instance_unit(&id)?;
    let output = systemctl(&["start", &unit])?;
    if !output.status.success() {
        return Err(output_error("instance start", &output));
    }
    list_instances()
}

#[tauri::command]
fn instance_action(id: String, action: String) -> Result<Vec<PetInstance>, String> {
    if !matches!(action.as_str(), "start" | "stop" | "restart") {
        return Err("unsupported instance action".into());
    }
    let unit = instance_unit(&id)?;
    let output = systemctl(&[&action, &unit])?;
    if !output.status.success() {
        return Err(output_error("instance action", &output));
    }
    list_instances()
}

#[tauri::command]
fn set_instance_autostart(id: String, enabled: bool) -> Result<Vec<PetInstance>, String> {
    let unit = instance_unit(&id)?;
    let action = if enabled { "enable" } else { "disable" };
    let output = systemctl(&[action, &unit])?;
    if !output.status.success() {
        return Err(output_error("instance autostart update", &output));
    }
    list_instances()
}

#[tauri::command]
fn instance_react(id: String, event: String) -> Result<RuntimeStatus, String> {
    if !matches!(event.as_str(), "attention" | "celebrate" | "wake") {
        return Err("unsupported reaction".into());
    }
    send_control_to(&id, json!({ "command": "react", "event": event }))
}

#[tauri::command]
fn instance_act(
    id: String,
    action: String,
    x: Option<f32>,
    direction: Option<i32>,
    event: Option<String>,
) -> Result<RuntimeStatus, String> {
    if !matches!(
        action.as_str(),
        "emote" | "move_to" | "follow" | "flee" | "look_at" | "rest" | "sleep" | "wake" | "cancel"
    ) {
        return Err("unsupported action".into());
    }
    let mut payload = json!({ "command": "act", "action": action });
    if matches!(action.as_str(), "move_to" | "follow" | "flee") {
        let value = x.ok_or_else(|| "movement action requires x".to_string())?;
        if !value.is_finite() || !(0.0..=32768.0).contains(&value) {
            return Err("movement x is outside the display range".into());
        }
        payload["x"] = json!(value);
    } else if action == "look_at" {
        let value = direction.ok_or_else(|| "look_at requires a direction".to_string())?;
        if !matches!(value, -1 | 1) {
            return Err("direction must be -1 or 1".into());
        }
        payload["direction"] = json!(value);
    } else if action == "emote" {
        let value = event.ok_or_else(|| "emote requires an event".to_string())?;
        if !matches!(value.as_str(), "attention" | "celebrate" | "wake") {
            return Err("unsupported emote".into());
        }
        payload["event"] = json!(value);
    }
    send_control_to(&id, payload)
}

fn validate_behavior_config(config: &BehaviorConfig) -> Result<(), String> {
    if !matches!(
        config.provider.kind.as_str(),
        "mock" | "openai-compatible" | "openai-responses"
    ) {
        return Err("unsupported AI provider".into());
    }
    if !(0.0..=1.0).contains(&config.interaction_intensity)
        || !(0.0..=1.0).contains(&config.personality.sociability)
        || !(0.0..=1.0).contains(&config.personality.curiosity)
        || !(0.0..=1.0).contains(&config.personality.energy)
    {
        return Err("behavior values must be between 0 and 1".into());
    }
    if !(1000..=60000).contains(&config.provider.timeout_ms) {
        return Err("AI timeout must be between 1000 and 60000 ms".into());
    }
    if config.provider.endpoint.len() > 512
        || config.provider.model.len() > 160
        || config.personality.archetype.len() > 96
    {
        return Err("behavior configuration contains an oversized field".into());
    }
    if config.provider.kind != "mock"
        && !(config.provider.endpoint.starts_with("http://")
            || config.provider.endpoint.starts_with("https://"))
    {
        return Err("AI endpoint must use http or https".into());
    }
    let key = config.provider.api_key_env.as_bytes();
    if key.is_empty()
        || key.len() > 96
        || !(key[0].is_ascii_alphabetic() || key[0] == b'_')
        || !key
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
    {
        return Err("API key environment variable name is invalid".into());
    }
    Ok(())
}

#[tauri::command]
fn load_behavior_config() -> Result<BehaviorConfig, String> {
    let path = behavior_config_path()?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("invalid behavior configuration: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BehaviorConfig::default()),
        Err(error) => Err(format!("cannot read behavior configuration: {error}")),
    }
}

#[tauri::command]
fn save_behavior_config(mut config: BehaviorConfig) -> Result<BehaviorConfig, String> {
    config.schema_version = 1;
    for key in BehaviorConfig::default().behaviors.keys() {
        config.behaviors.entry(key.clone()).or_insert(true);
    }
    validate_behavior_config(&config)?;
    let path = behavior_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create behavior config directory: {error}"))?;
    }
    let contents = serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|error| format!("cannot write behavior configuration: {error}"))?;
    file.write_all(&contents)
        .map_err(|error| format!("cannot write behavior configuration: {error}"))?;
    file.write_all(b"\n").map_err(|error| error.to_string())?;
    file.sync_all()
        .map_err(|error| format!("cannot sync behavior configuration: {error}"))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("cannot replace behavior configuration: {error}"))?;
    Ok(config)
}

#[tauri::command]
fn behavior_world_status() -> Result<Value, String> {
    let path = behavior_world_path()?;
    match fs::read_to_string(&path) {
        Ok(contents) => {
            serde_json::from_str(&contents).map_err(|error| format!("invalid world state: {error}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({
            "schema_version": 1,
            "timestamp": 0,
            "provider": { "state": "offline", "message": "behavior service is offline", "checked_at": 0 },
            "interaction_intensity": 0,
            "instances": [],
            "scheduler": { "queued": [], "active": [], "cooldowns": {} }
        })),
        Err(error) => Err(format!("cannot read world state: {error}")),
    }
}

#[tauri::command]
fn read_behavior_timeline(limit: usize) -> Result<Vec<BehaviorEvent>, String> {
    let path = behavior_timeline_path()?;
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("cannot read behavior timeline: {error}")),
    };
    let mut values: Vec<BehaviorEvent> = contents
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let keep = limit.clamp(20, 500);
    if values.len() > keep {
        values.drain(0..values.len() - keep);
    }
    Ok(values)
}

#[tauri::command]
fn context_status() -> Result<ServiceStatus, String> {
    service_status_for("pet-ark-context.service")
}

#[tauri::command]
fn context_action(action: String) -> Result<ServiceStatus, String> {
    if !matches!(action.as_str(), "start" | "stop" | "restart") {
        return Err("unsupported context action".into());
    }
    let output = systemctl(&[&action, "pet-ark-context.service"])?;
    if !output.status.success() {
        return Err(output_error("context service action", &output));
    }
    context_status()
}

#[tauri::command]
fn set_context_autostart(enabled: bool) -> Result<ServiceStatus, String> {
    let action = if enabled { "enable" } else { "disable" };
    let output = systemctl(&[action, "pet-ark-context.service"])?;
    if !output.status.success() {
        return Err(output_error("context autostart update", &output));
    }
    context_status()
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
fn read_logs(limit: usize, instance: Option<String>) -> Result<Vec<LogEntry>, String> {
    let count = limit.clamp(20, 300).to_string();
    let unit = instance_unit(instance.as_deref().unwrap_or("default"))?;
    let output = Command::new("journalctl")
        .args([
            "--user",
            "-u",
            &unit,
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
            instance_service_status,
            service_action,
            set_autostart,
            runtime_status,
            instance_runtime_status,
            load_config,
            load_instance_config,
            save_config,
            save_instance_config,
            list_characters,
            preview_asset,
            read_logs,
            list_instances,
            create_instance,
            instance_action,
            set_instance_autostart,
            instance_react,
            instance_act,
            load_behavior_config,
            save_behavior_config,
            behavior_world_status,
            read_behavior_timeline,
            context_status,
            context_action,
            set_context_autostart,
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

    #[test]
    fn default_behavior_configuration_is_valid() {
        let config = BehaviorConfig::default();
        validate_behavior_config(&config).expect("default behavior config should be valid");
        assert_eq!(config.behaviors.len(), 12);
    }
}
