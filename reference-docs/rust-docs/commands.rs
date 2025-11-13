use std::sync::{Arc, mpsc};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use serialport::available_ports;
use tauri::{State, Manager};
use anyhow::{Result, anyhow};
use log::{info, error, warn};
use csv::ReaderBuilder;

use crate::{AppState, SerialConfig, SendMessage, CsvLoopProgress};
use crate::can_protocol::{create_can_config_packet, create_can_send_packet_fixed, create_can_send_packet_variable};
use crate::csv_loop::{run_csv_loop, run_csv_loop_with_preloaded_data};
use crate::io_thread::start_io_thread;
use crate::vehicle_control::extract_vehicle_control;

/// Get available serial ports
#[tauri::command]
pub async fn get_available_ports() -> Result<Vec<String>, String> {
    match available_ports() {
        Ok(ports) => {
            let port_names: Vec<String> = ports
                .into_iter()
                .map(|p| p.port_name)
                .collect();
            Ok(port_names)
        }
        Err(e) => {
            error!("Failed to get available ports: {}", e);
            Err(format!("Failed to get available ports: {}", e))
        }
    }
}

/// Send CAN configuration through channel
async fn send_can_config(state: &State<'_, AppState>, config: &SerialConfig) -> Result<()> {
    info!("Sending CAN config");
    let packet = create_can_config_packet(config);

    let tx_send = state.tx_send.lock().unwrap();
    if let Some(ref sender) = *tx_send {
        sender.send(SendMessage { packet }).map_err(|e| {
            error!("Failed to send config packet through channel: {}", e);
            anyhow!("Failed to send config packet")
        })?;
        info!("Config packet sent through channel");
    } else {
        error!("Send channel not available");
        return Err(anyhow!("Send channel not available"));
    }

    Ok(())
}

/// Connect to serial port
#[tauri::command]
pub async fn connect_serial(
    config: SerialConfig,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    info!("Connecting to serial port: {}", config.port);

    // Check if already connected
    {
        let is_connected = state.is_connected.lock().unwrap();
        if *is_connected {
            return Err("Already connected".to_string());
        }
    }

    // Open serial port
    println!("🔌 [Connect] Opening serial port: {} at {} baud", config.port, config.baud_rate);
    let port = match serialport::new(&config.port, config.baud_rate)
        .timeout(Duration::from_millis(1000))
        .open()
    {
        Ok(port) => {
            println!("✅ [Connect] Serial port opened successfully");
            port
        }
        Err(e) => {
            println!("❌ [Connect] Failed to open port: {}", e);
            return Err(format!("Failed to open port: {}", e));
        }
    };

    // Create send channel
    println!("📡 [Connect] Creating send channel");
    let (tx_send, rx_send) = mpsc::channel();

    // Save sender to state
    {
        let mut tx_send_guard = state.tx_send.lock().unwrap();
        *tx_send_guard = Some(tx_send);
    }

    // Set connection state
    {
        let mut is_connected = state.is_connected.lock().unwrap();
        *is_connected = true;
    }

    // Send CAN config through channel
    println!("⚙️  [Connect] Sending CAN configuration");
    if let Err(e) = send_can_config(&state, &config).await {
        warn!("Failed to send CAN configuration: {}", e);
        println!("⚠️  [Connect] Failed to send CAN configuration: {}", e);
    }

    // Start I/O thread
    println!("🧵 [Connect] Starting I/O thread");
    let state_clone = state.inner().clone();
    start_io_thread(port, state_clone, rx_send, app_handle);

    println!("✅ [Connect] Serial port connected successfully - Ready to receive messages!");
    info!("Serial port connected successfully");
    Ok("Connected successfully".to_string())
}

/// Disconnect from serial port
#[tauri::command]
pub async fn disconnect_serial(state: State<'_, AppState>) -> Result<String, String> {
    info!("Disconnecting serial port");

    state.receive_thread_running.store(false, Ordering::SeqCst);
    state.write_thread_running.store(false, Ordering::SeqCst);

    {
        let mut tx_send = state.tx_send.lock().unwrap();
        *tx_send = None;
    }

    {
        let mut is_connected = state.is_connected.lock().unwrap();
        *is_connected = false;
    }

    thread::sleep(Duration::from_millis(100));

    info!("Serial port disconnected");
    Ok("Disconnected".to_string())
}

/// Send CAN message
#[tauri::command]
pub async fn send_can_message(
    id: String,
    data: String,
    frame_type: String,
    protocol_length: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    info!("Sending CAN message - ID: {}, Data: {}, Type: {}, Protocol: {}", id, data, frame_type, protocol_length);

    // Check connection state
    {
        let is_connected = state.is_connected.lock().unwrap();
        if !*is_connected {
            error!("Connection check failed: device not connected");
            return Err("Not connected".to_string());
        }
        // info!("Connection check passed");
    }

    // Create send packet based on protocol_length
    // info!("Creating CAN packet...");
    let packet: Vec<u8> = if protocol_length == "variable" {
        match create_can_send_packet_variable(&id, &data, &frame_type) {
            Ok(p) => {
                info!("CAN packet (variable) created successfully");
                p
            },
            Err(e) => {
                error!("CAN packet creation failed: {}", e);
                return Err(format!("Failed to create packet: {}", e));
            }
        }
    } else {
        match create_can_send_packet_fixed(&id, &data, &frame_type) {
            Ok(p) => {
                // info!("CAN packet (fixed) created successfully");
                p
            },
            Err(e) => {
                error!("CAN packet creation failed: {}", e);
                return Err(format!("Failed to create packet: {}", e));
            }
        }
    };

    // Send data through channel
    // info!("Preparing to send packet through channel...");
    info!("Packet content: {:02X?}", packet);

    let tx_send = state.tx_send.lock().unwrap();
    if let Some(ref sender) = *tx_send {
        match sender.send(SendMessage { packet }) {
            Ok(_) => {
                // info!("CAN message sent to write thread successfully!");
                Ok("Message sent successfully".to_string())
            }
            Err(e) => {
                error!("Failed to send message through channel: {}", e);
                Err(format!("Failed to send message: {}", e))
            }
        }
    } else {
        error!("Send channel not available");
        Err("Send channel not available".to_string())
    }
}

/// Start CSV loop
#[tauri::command]
pub async fn start_csv_loop(
    csv_content: String,
    interval_ms: u64,
    can_id_column_index: usize,
    can_data_column_index: usize,
    csv_start_row_index: usize,
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<String, String> {
    println!("🚀 [Rust] start_csv_loop called - Interval: {}ms, CSV length: {}, Start row: {}", interval_ms, csv_content.len(), csv_start_row_index);
    info!("Starting CSV loop - Interval: {}ms, Start row: {}", interval_ms, csv_start_row_index);

    if state.csv_loop_running.load(Ordering::SeqCst) {
        println!("❌ [Rust] CSV loop already running");
        return Err("CSV loop already running".to_string());
    }

    {
        let is_connected = state.is_connected.lock().unwrap();
        if !*is_connected {
            println!("❌ [Rust] Not connected");
            return Err("Not connected".to_string());
        }
    }
    // println!("✅ [Rust] Connection check passed");

    state.csv_loop_running.store(true, Ordering::SeqCst);

    let state_clone = Arc::new(AppState {
        tx_send: state.tx_send.clone(),
        is_connected: state.is_connected.clone(),
        csv_loop_running: state.csv_loop_running.clone(),
        receive_thread_running: state.receive_thread_running.clone(),
        write_thread_running: state.write_thread_running.clone(),
    });
    let csv_content_clone = csv_content.clone();
    let config_clone = config.clone();

    std::thread::spawn(move || {
        if let Err(e) = run_csv_loop(
            csv_content_clone,
            interval_ms,
            can_id_column_index,
            can_data_column_index,
            csv_start_row_index,
            config_clone,
            state_clone,
        ) {
            error!("CSV loop error: {}", e);
        }
    });

    Ok("CSV loop started".to_string())
}

/// Stop CSV loop
#[tauri::command]
pub async fn stop_csv_loop(state: State<'_, AppState>) -> Result<String, String> {
    info!("Stopping CSV loop");
    state.csv_loop_running.store(false, Ordering::SeqCst);
    thread::sleep(Duration::from_millis(100));
    Ok("CSV loop stopped".to_string())
}

/// Preload CSV data and parse vehicle control information
#[tauri::command]
pub async fn preload_csv_data(
    csv_content: String,
    can_id_column_index: usize,
    can_data_column_index: usize,
    csv_start_row_index: usize,
) -> Result<Vec<CsvLoopProgress>, String> {
    println!("📂 [Rust] preload_csv_data called");

    let mut reader = ReaderBuilder::new()
        .has_headers(false)
        .from_reader(csv_content.as_bytes());

    let mut records = Vec::new();
    for result in reader.records() {
        let record = result.map_err(|e| format!("CSV read error: {}", e))?;
        records.push(record);
    }

    println!("✅ [Rust] Loaded {} records from CSV", records.len());

    if records.is_empty() {
        return Err("CSV file is empty".to_string());
    }

    if csv_start_row_index >= records.len() {
        return Err(format!("Start row index {} out of range (max: {})", csv_start_row_index, records.len() - 1));
    }

    let filtered_records: Vec<_> = records.iter().skip(csv_start_row_index).collect();
    let total = filtered_records.len();

    let mut progress_list = Vec::new();

    for (index, record) in filtered_records.iter().enumerate() {
        let can_id = record
            .get(can_id_column_index)
            .ok_or_else(|| "CAN ID column index out of range".to_string())?
            .to_string();

        let can_data = record
            .get(can_data_column_index)
            .ok_or_else(|| "CAN Data column index out of range".to_string())?
            .to_string();

        let vehicle_control = extract_vehicle_control(&can_data).ok();

        progress_list.push(CsvLoopProgress {
            index,
            total,
            can_id,
            can_data,
            vehicle_control,
        });
    }

    println!("✅ [Rust] Preloaded {} records with vehicle control data", progress_list.len());
    Ok(progress_list)
}

/// Start CSV loop with preloaded data
#[tauri::command]
pub async fn start_csv_loop_with_preloaded_data(
    preloaded_data: Vec<CsvLoopProgress>,
    interval_ms: u64,
    config: serde_json::Value,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    println!("🚀 [Rust] start_csv_loop_with_preloaded_data called - Interval: {}ms, Records: {}", interval_ms, preloaded_data.len());
    info!("Starting CSV loop with preloaded data - Interval: {}ms, Records: {}", interval_ms, preloaded_data.len());

    if state.csv_loop_running.load(Ordering::SeqCst) {
        println!("❌ [Rust] CSV loop already running");
        return Err("CSV loop already running".to_string());
    }

    state.csv_loop_running.store(true, Ordering::SeqCst);

    let state_arc = Arc::new(AppState {
        tx_send: state.tx_send.clone(),
        is_connected: state.is_connected.clone(),
        csv_loop_running: state.csv_loop_running.clone(),
        receive_thread_running: state.receive_thread_running.clone(),
        write_thread_running: state.write_thread_running.clone(),
    });

    let config_clone = config.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_csv_loop_with_preloaded_data(
            preloaded_data,
            interval_ms,
            config_clone,
            state_arc,
            app_handle,
        ) {
            error!("CSV loop error: {}", e);
        }
    });

    Ok("CSV loop started".to_string())
}

/// 打开系统监控窗口
#[tauri::command]
pub async fn open_system_monitor_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    match app_handle.get_webview_window("system-monitor") {
        Some(window) => {
            // 窗口已存在，显示并置于前面
            let _ = window.show();
            let _ = window.set_focus();
            Ok(())
        }
        None => {
            // 窗口不存在，创建新窗口
            tauri::WebviewWindowBuilder::new(&app_handle, "system-monitor", tauri::WebviewUrl::App("system-monitor.html".into()))
                .title("系统性能监控")
                .inner_size(1600.0, 1000.0)
                .build()
                .map_err(|e| format!("Failed to create system monitor window: {}", e))?;
            Ok(())
        }
    }
}

/// 关闭系统监控窗口
#[tauri::command]
pub async fn close_system_monitor_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("system-monitor") {
        window.close().map_err(|e| format!("Failed to close system monitor window: {}", e))?;
    }
    Ok(())
}

