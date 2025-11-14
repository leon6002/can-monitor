use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

mod serial;
use serial::{SerialManager, SerialPortInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CANMessage {
    id: String,
    data: String,
    timestamp: u64,
    is_extended: bool,
}

// Global state for serial port management
pub struct AppState {
    serial_manager: Arc<Mutex<SerialManager>>,
}

#[tauri::command]
async fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    println!("[COMMAND] list_serial_ports 被调用");
    let result = serialport::available_ports()
        .map(|ports| {
            let port_list: Vec<SerialPortInfo> = ports
                .into_iter()
                .map(|port| SerialPortInfo {
                    name: port.port_name.clone(),
                    path: port.port_name,
                })
                .collect();
            println!("[COMMAND] 找到 {} 个串口", port_list.len());
            for port in &port_list {
                println!("[COMMAND]   - {}", port.name);
            }
            port_list
        })
        .map_err(|e| {
            let err_msg = format!("Failed to list ports: {}", e);
            eprintln!("[COMMAND ERROR] {}", err_msg);
            err_msg
        });
    result
}

#[tauri::command]
async fn connect_serial_port(
    port_name: String,
    baud_rate: u32,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    println!(
        "[COMMAND] connect_serial_port 被调用: port={}, baud={}",
        port_name, baud_rate
    );
    let mut manager = state.serial_manager.lock().unwrap();
    let result = manager.connect(&port_name, baud_rate, app);
    match &result {
        Ok(_) => println!("[COMMAND] ✓ connect_serial_port 成功"),
        Err(e) => eprintln!("[COMMAND ERROR] ✗ connect_serial_port 失败: {}", e),
    }
    result
}

#[tauri::command]
async fn disconnect_serial_port(state: State<'_, AppState>) -> Result<(), String> {
    println!("[COMMAND] disconnect_serial_port 被调用");
    let mut manager = state.serial_manager.lock().unwrap();
    manager.disconnect();
    println!("[COMMAND] ✓ disconnect_serial_port 完成");
    Ok(())
}

#[tauri::command]
async fn send_can_message(
    id: String,
    data: String,
    is_extended: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!(
        "[COMMAND] send_can_message 被调用: id={}, data={}, extended={}",
        id, data, is_extended
    );
    let manager = state.serial_manager.lock().unwrap();
    let result = manager.send_can_message(&id, &data, is_extended);
    match &result {
        Ok(_) => println!("[COMMAND] ✓ send_can_message 成功"),
        Err(e) => eprintln!("[COMMAND ERROR] ✗ send_can_message 失败: {}", e),
    }
    result
}

#[tauri::command]
async fn get_connection_status(state: State<'_, AppState>) -> Result<bool, String> {
    let manager = state.serial_manager.lock().unwrap();
    let status = manager.is_connected();
    println!("[COMMAND] get_connection_status: {}", status);
    Ok(status)
}

// Project Management Commands

#[tauri::command]
async fn save_project_to_file(project_json: String, file_path: String) -> Result<(), String> {
    println!("[COMMAND] save_project_to_file: {}", file_path);

    let path = PathBuf::from(&file_path);

    // Create parent directory if it doesn't exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Write project JSON to file
    fs::write(&path, project_json).map_err(|e| format!("Failed to write project file: {}", e))?;

    println!("[COMMAND] ✓ Project saved successfully");
    Ok(())
}

#[tauri::command]
async fn load_project_from_file(file_path: String) -> Result<String, String> {
    println!("[COMMAND] load_project_from_file: {}", file_path);

    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(format!("Project file not found: {}", file_path));
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read project file: {}", e))?;

    println!("[COMMAND] ✓ Project loaded successfully");
    Ok(content)
}

// Note: Directory selection is now handled by the frontend using @tauri-apps/plugin-dialog

#[tauri::command]
async fn check_project_exists(file_path: String) -> Result<bool, String> {
    let path = PathBuf::from(&file_path);
    Ok(path.exists())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("========================================");
    println!("CAN Monitor 启动");
    println!("========================================");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            println!("[SETUP] 初始化应用状态");
            let serial_manager = Arc::new(Mutex::new(SerialManager::new()));
            app.manage(AppState { serial_manager });
            println!("[SETUP] ✓ 应用状态初始化完成");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_serial_port,
            disconnect_serial_port,
            send_can_message,
            get_connection_status,
            save_project_to_file,
            load_project_from_file,
            check_project_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
