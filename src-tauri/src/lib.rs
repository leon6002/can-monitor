use serde::{Deserialize, Serialize};
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
    println!("[COMMAND] connect_serial_port 被调用: port={}, baud={}", port_name, baud_rate);
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
    println!("[COMMAND] send_can_message 被调用: id={}, data={}, extended={}", id, data, is_extended);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("========================================");
    println!("CAN Monitor 启动");
    println!("========================================");

    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
