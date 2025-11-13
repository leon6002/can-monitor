//! CSV 循环相关的函数
//! 包括：CSV 数据读取、循环处理、发送等功能

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use anyhow::{Result, anyhow};
use csv::ReaderBuilder;
use log::{info, error};
use tauri::Emitter;

use crate::{AppState, SendMessage, CsvLoopProgress};
use crate::can_protocol::{create_can_send_packet_fixed, create_can_send_packet_variable};
use crate::vehicle_control::extract_vehicle_control;

/// 生成停止信号数据
/// 格式：
/// - 字节0-2：04 00 00（保持D档，速度为0）
/// - 字节3-5：00 00 00（转向角为0）
/// - 字节6：心跳值（最后一条数据的第7字节高位+1，最大F0，超过则回到00）
/// - 字节7：校验位（前7字节的XOR）
fn generate_stop_signal(last_can_data: &str) -> Result<String> {
    let bytes: Vec<&str> = last_can_data.split_whitespace().collect();

    if bytes.len() < 8 {
        return Err(anyhow!("Invalid CAN data format for stop signal generation"));
    }

    // 获取第7字节（索引6）的高位作为心跳值
    let byte7_str = bytes[6];
    let byte7 = u8::from_str_radix(byte7_str, 16)
        .map_err(|_| anyhow!("Failed to parse byte 7 as hex"))?;

    // 心跳值 = 第7字节高位 + 1，最大值F0，超过则回到00
    let heartbeat_high = (byte7 >> 4) + 1;
    let heartbeat = if heartbeat_high > 0x0F { 0x00 } else { heartbeat_high };
    let byte7_new = (heartbeat << 4) | 0x00; // 低位为0

    // 停止信号：04 00 00 00 00 00 [heartbeat]0 [checksum]
    let bytes_fixed = [0x04u8, 0x00, 0x00, 0x00, 0x00, 0x00];

    // 计算校验位（前7字节的XOR）
    let mut checksum = 0u8;
    for &b in &bytes_fixed {
        checksum ^= b;
    }
    checksum ^= byte7_new;

    // 生成停止信号数据字符串
    let stop_signal = format!(
        "{:02X} {:02X} {:02X} {:02X} {:02X} {:02X} {:02X} {:02X}",
        bytes_fixed[0], bytes_fixed[1], bytes_fixed[2], bytes_fixed[3],
        bytes_fixed[4], bytes_fixed[5], byte7_new, checksum
    );

    info!("📤 [Rust] Generated stop signal: {} (heartbeat: {:X}, checksum: {:02X})", stop_signal, heartbeat, checksum);

    Ok(stop_signal)
}

/// 运行 CSV 循环 - 从 CSV 内容读取数据并发送
pub fn run_csv_loop(
    csv_content: String,
    interval_ms: u64,
    can_id_column_index: usize,
    can_data_column_index: usize,
    csv_start_row_index: usize,
    config: serde_json::Value,
    state: Arc<AppState>,
) -> Result<()> {
    info!("🔄 [Rust] run_csv_loop started - Start row: {}", csv_start_row_index);

    // Extract frame_type and protocol_length from config
    // let frame_type = config.get("frame_type")
    //     .and_then(|v| v.as_str())
    //     .unwrap_or("extended")
    //     .to_string();
    // todo 自动行驶先写死为extended，因为ID有四字节
    let frame_type = "extended";

    let protocol_length = config.get("protocol_length")
        .and_then(|v| v.as_str())
        .unwrap_or("fixed")
        .to_string();

    // Parse CSV content from string
    let mut reader = ReaderBuilder::new()
        .has_headers(false)
        .from_reader(csv_content.as_bytes());

    let mut records = Vec::new();
    for result in reader.records() {
        let record = result.map_err(|e| anyhow!("CSV read error: {}", e))?;
        records.push(record);
    }

    info!("✅ [Rust] Loaded {} records from CSV", records.len());

    if records.is_empty() {
        info!("❌ [Rust] CSV file is empty");
        return Err(anyhow!("CSV file is empty"));
    }

    // Check if start row index is valid
    if csv_start_row_index >= records.len() {
        info!("❌ [Rust] Start row index {} out of range (max: {})", csv_start_row_index, records.len() - 1);
        return Err(anyhow!("Start row index out of range"));
    }

    // Filter records starting from csv_start_row_index
    let filtered_records: Vec<_> = records.iter().skip(csv_start_row_index).collect();

    if filtered_records.is_empty() {
        info!("❌ [Rust] No records after start row index");
        return Err(anyhow!("No records after start row index"));
    }

    info!("✅ [Rust] Using {} records starting from row {}", filtered_records.len(), csv_start_row_index);

    let mut last_can_data: Option<String> = None;
    let mut user_stopped = false;

    // Loop through records once
    for (index, record) in filtered_records.iter().enumerate() {
        // Check if loop should stop
        if !state.csv_loop_running.load(Ordering::SeqCst) {
            info!("🛑 [Rust] CSV loop stopped by user");
            user_stopped = true;
            break;
        }

        // Get CAN ID and Data from specified columns
        let can_id = record
            .get(can_id_column_index)
            .ok_or_else(|| anyhow!("CAN ID column index out of range"))?
            .to_string();

        let can_data = record
            .get(can_data_column_index)
            .ok_or_else(|| anyhow!("CAN Data column index out of range"))?
            .to_string();

        // Check if CAN data is empty - if so, stop the loop
        if can_data.trim().is_empty() {
            info!("🛑 [Rust] Empty CAN data detected - CSV loop ended");
            break;
        }

        // Try to parse vehicle control data (speed and steering angle)
        let vehicle_control = extract_vehicle_control(&can_data).ok();

        if let Some(ref vc) = vehicle_control {
            info!("Parsed vehicle control - Speed: {} mm/s, Steering: {:.3} rad",
                  vc.linear_velocity_mms, vc.steering_angle);
        }

        // Create and send packet based on protocol_length
        let packet = if protocol_length == "variable" {
            create_can_send_packet_variable(&can_id, &can_data, &frame_type)?
        } else {
            info!("Creating CAN send packet (fixed) - ID: {}, Data: {}, Type: {}", can_id, can_data, frame_type);
            create_can_send_packet_fixed(&can_id, &can_data, &frame_type)?
        };

        // Send packet through channel
        {
            let tx_send = state.tx_send.lock().unwrap();
            if let Some(ref sender) = *tx_send {
                if let Err(e) = sender.send(SendMessage { packet }) {
                    error!("Failed to send packet through channel: {}", e);
                } else {
                    info!("Sent CAN message - ID: {}, Data: {}", can_id, can_data);
                }
            }
        }

        // Record the last CAN data for stop signal
        last_can_data = Some(can_data.clone());

        // Sleep for interval (except after the last record)
        if index < filtered_records.len() - 1 {
            thread::sleep(Duration::from_millis(interval_ms));
        }
    }

    // Send stop signal if loop was stopped by user
    if user_stopped {
        if let Some(last_data) = last_can_data {
            info!("📤 [Rust] Sending stop signal based on last data: {}", last_data);

            // Generate stop signal
            if let Ok(stop_signal_data) = generate_stop_signal(&last_data) {
                // Send stop signal with CAN ID 0x18C4D2D0
                let stop_can_id = "0x18C4D2D0";
                let packet = if protocol_length == "variable" {
                    create_can_send_packet_variable(stop_can_id, &stop_signal_data, &frame_type)?
                } else {
                    create_can_send_packet_fixed(stop_can_id, &stop_signal_data, &frame_type)?
                };

                // Send stop signal packet
                {
                    let tx_send = state.tx_send.lock().unwrap();
                    if let Some(ref sender) = *tx_send {
                        if let Err(e) = sender.send(SendMessage { packet }) {
                            error!("Failed to send stop signal: {}", e);
                        } else {
                            info!("Sent stop signal - ID: {}, Data: {}", stop_can_id, stop_signal_data);
                        }
                    }
                }
            }
        }
    }

    info!("✅ [Rust] CSV loop completed");

    // Stop the loop flag
    state.csv_loop_running.store(false, Ordering::SeqCst);

    Ok(())
}

/// 运行预加载 CSV 循环 - 从预加载的数据发送
pub fn run_csv_loop_with_preloaded_data(
    preloaded_data: Vec<CsvLoopProgress>,
    interval_ms: u64,
    config: serde_json::Value,
    state: Arc<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<()> {
    info!("🔄 [Rust] run_csv_loop_with_preloaded_data started - Records: {}", preloaded_data.len());

    let protocol_length = config.get("protocol_length")
        .and_then(|v| v.as_str())
        .unwrap_or("fixed");

    let frame_type = "extended"; // CSV driving data always uses extended frame
    let mut last_can_data: Option<String> = None;
    let mut user_stopped = false;

    // Loop through records once
    for (index, progress) in preloaded_data.iter().enumerate() {
        // Check if loop should stop
        if !state.csv_loop_running.load(Ordering::SeqCst) {
            info!("🛑 [Rust] CSV loop stopped by user");
            user_stopped = true;
            break;
        }

        let can_id = &progress.can_id;
        let can_data = &progress.can_data;

        // Check if CAN data is empty - if so, stop the loop
        if can_data.trim().is_empty() {
            info!("Empty CAN data detected - CSV loop ended");
            break;
        }

        // Log vehicle control data if available
        if let Some(ref vc) = progress.vehicle_control {
            info!("🛞 Record {}/{} - Speed: {} mm/s, Steering: {:.2} degree",
                  index + 1, preloaded_data.len(), vc.linear_velocity_mms, vc.steering_angle);
        }

        let packet = if protocol_length == "variable" {
            create_can_send_packet_variable(&can_id, &can_data, frame_type)?
        } else {
            create_can_send_packet_fixed(&can_id, &can_data, frame_type)?
        };

        // Send packet through channel
        {
            let tx_send = state.tx_send.lock().unwrap();
            if let Some(ref sender) = *tx_send {
                if let Err(e) = sender.send(SendMessage { packet }) {
                    error!("Failed to send packet through channel: {}", e);
                } else {
                    info!("Sent CAN message - ID: {}, Data: {}", can_id, can_data);
                }
            }
        }

        // Record the last CAN data for stop signal
        last_can_data = Some(can_data.clone());

        // Sleep for interval (except after the last record)
        if index < preloaded_data.len() - 1 {
            thread::sleep(Duration::from_millis(interval_ms));
        }
    }

    // Send stop signal if loop was stopped by user
    if user_stopped {
        if let Some(last_data) = last_can_data {

            // Generate stop signal
            if let Ok(stop_signal_data) = generate_stop_signal(&last_data) {
                // Send stop signal with CAN ID 0x18C4D2D0
                let stop_can_id = "0x18C4D2D0";
                let packet = if protocol_length == "variable" {
                    create_can_send_packet_variable(stop_can_id, &stop_signal_data, frame_type)?
                } else {
                    create_can_send_packet_fixed(stop_can_id, &stop_signal_data, frame_type)?
                };

                // Send stop signal packet
                {
                    let tx_send = state.tx_send.lock().unwrap();
                    if let Some(ref sender) = *tx_send {
                        if let Err(e) = sender.send(SendMessage { packet }) {
                            error!("Failed to send stop signal: {}", e);
                        } else {
                            info!("Sent stop signal - ID: {}, Data: {}", stop_can_id, stop_signal_data);
                        }
                    }
                }
            }
        }
    }

    info!("CSV loop completed");

    // Stop the loop flag
    state.csv_loop_running.store(false, Ordering::SeqCst);

    // 发送 CSV 循环完成事件到前端
    let _ = app_handle.emit("csv-loop-completed", serde_json::json!({
        "status": "completed",
        "timestamp": chrono::Local::now().to_rfc3339(),
    }));
    info!("📤 [Rust] Emitted csv-loop-completed event");

    Ok(())
}

