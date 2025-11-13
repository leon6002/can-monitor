//! I/O 线程相关的函数
//! 包括：串口读写、消息缓冲、事件发送等功能

use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serialport::SerialPort;
use tauri::Emitter;
use log::{info, warn, error};

use crate::{AppState, SendMessage};
use crate::can_protocol::{parse_received_can_message, parse_distance_from_data, parse_vehicle_status_8byte};

/// 启动 I/O 线程 - 独占拥有串口，处理读写
pub fn start_io_thread(
    mut serial_port: Box<dyn SerialPort>,
    state: AppState,
    rx_send: mpsc::Receiver<SendMessage>,
    app_handle: tauri::AppHandle,
) {
    state.write_thread_running.store(true, Ordering::SeqCst);
    state.receive_thread_running.store(true, Ordering::SeqCst);

    thread::spawn(move || {
        let mut buffer = vec![0u8; 1024];
        let mut message_buffer = Vec::new();  // 消息缓冲区，用于组装完整的消息

        println!("🚀 [I/O Thread] Started - Ready to handle read/write operations");
        info!("🚀 [I/O Thread] Started - Ready to handle read/write operations");

        while state.write_thread_running.load(Ordering::SeqCst) {
            // 尝试接收写入请求（非阻塞）
            match rx_send.try_recv() {
                Ok(msg) => {
                    // info!("I/O thread: sending {} bytes", msg.packet.len());
                    match serial_port.write_all(&msg.packet) {
                        Ok(_) => {
                            if let Err(e) = serial_port.flush() {
                                warn!("I/O thread: flush failed: {}", e);
                            }
                        }
                        Err(e) => {
                            error!("I/O thread: write failed: {}", e);
                        }
                    }
                }
                Err(mpsc::TryRecvError::Empty) => {
                    // 没有写入请求，尝试读取
                    match serial_port.read(&mut buffer) {
                        Ok(n) if n > 0 => {
                            let received_data = &buffer[..n];
                            println!("📥 [I/O Thread] Received {} bytes: {:02X?}", n, received_data);
                            info!("📥 [I/O Thread] Received {} bytes: {:02X?}", n, received_data);

                            // 将接收到的数据添加到消息缓冲区
                            message_buffer.extend_from_slice(received_data);
                            println!("📦 [I/O Thread] Message buffer size: {} bytes, content: {:02X?}", message_buffer.len(), message_buffer);

                            // 处理缓冲区中的完整消息
                            process_message_buffer(&mut message_buffer, &app_handle);
                        }
                        Ok(_) => {
                            // 读取0字节，短暂休眠
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                            // 超时是正常的，继续循环
                            continue;
                        }
                        Err(e) => {
                            error!("I/O thread: read error: {}", e);
                            println!("❌ [I/O Thread] Read error: {}", e);
                            thread::sleep(Duration::from_millis(10));
                        }
                    }
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    info!("I/O thread: channel disconnected, exiting");
                    break;
                }
            }
        }

        state.receive_thread_running.store(false, Ordering::SeqCst);
        info!("I/O thread stopped");
    });
}

/// 验证消息的校验和
///
/// 协议格式：固定20字节
/// - 字节0-1: 消息头 (0xAA 0x55)
/// - 字节2-18: 数据部分
/// - 字节19: 校验和 (字节2-18的和的低8位)
fn verify_checksum(message: &[u8]) -> bool {
    if message.len() < 20 {
        return false;
    }

    let checksum_received = message[19];
    let checksum_calculated: u8 = message[2..19].iter().map(|&b| b as u32).sum::<u32>() as u8;

    if checksum_received != checksum_calculated {
        println!("❌ [Checksum] Mismatch - Received: 0x{:02X}, Calculated: 0x{:02X}",
                 checksum_received, checksum_calculated);
        return false;
    }

    println!("✅ [Checksum] Valid - 0x{:02X}", checksum_calculated);
    true
}

/// 在缓冲区中查找消息头 (AA 55)
/// 返回消息头的位置，如果找到则清理前面的数据
fn find_and_align_message_header(message_buffer: &mut Vec<u8>) -> bool {
    if let Some(header_pos) = message_buffer.windows(2).position(|w| w == [0xAA, 0x55]) {
        println!("🎯 [I/O Thread] Found message header at position {}", header_pos);

        if header_pos > 0 {
            println!("⚠️  [I/O Thread] Discarding {} bytes before message header", header_pos);
            message_buffer.drain(0..header_pos);
        }
        true
    } else {
        // 没有找到完整的消息头，清理无效的字节
        if message_buffer.len() < 2 {
            println!("⏳ [I/O Thread] Buffer too small to search for header: {} bytes", message_buffer.len());
            return false;
        }

        if message_buffer[0] == 0xAA {
            println!("⚠️  [I/O Thread] Found 0xAA at position 0, but next byte is 0x{:02X} (not 0x55), discarding", message_buffer[1]);
            message_buffer.remove(0);
        } else {
            println!("⚠️  [I/O Thread] First byte is 0x{:02X} (not 0xAA), discarding", message_buffer[0]);
            message_buffer.remove(0);
        }
        false
    }
}

/// 提取完整的消息（20字节）
fn extract_complete_message(message_buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    const FIXED_MESSAGE_LENGTH: usize = 20;

    if message_buffer.len() >= FIXED_MESSAGE_LENGTH {
        let complete_message = message_buffer.drain(0..FIXED_MESSAGE_LENGTH).collect::<Vec<_>>();

        let raw_hex = complete_message
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" ");

        println!("✅ [I/O Thread] Complete message extracted ({} bytes): {}", complete_message.len(), raw_hex);
        Some(complete_message)
    } else {
        println!("⏳ [I/O Thread] Incomplete message: have {} bytes, need {} bytes", message_buffer.len(), FIXED_MESSAGE_LENGTH);
        None
    }
}

/// 处理已解析的 CAN 消息
fn handle_parsed_can_message(
    can_id: &str,
    can_data: &str,
    frame_type: &str,
    raw_hex: &str,
    timestamp: &str,
    app_handle: &tauri::AppHandle,
) {
    println!("✅ [I/O Thread] Parsed CAN message - ID: {}, Data: {}", can_id, can_data);
    info!("✅ [I/O Thread] Parsed CAN message - ID: {}, Data: {}", can_id, can_data);

    // 尝试解析新协议的车辆状态（ID: 0x00000123）
    let mut vehicle_status: Option<(String, f32)> = None;
    if can_id == "0x00000123" {
        vehicle_status = parse_vehicle_status_8byte(&can_data);
    }

    // 发送通用CAN消息事件（包含原始数据）
    let mut can_message = serde_json::json!({
        "id": can_id,
        "data": can_data,
        "rawData": raw_hex,
        "timestamp": timestamp,
        "direction": "received",
        "frameType": frame_type,
    });

    // 如果解析了车辆状态，添加到消息中
    if let Some((gear, steering_angle)) = vehicle_status {
        can_message["gear"] = serde_json::json!(gear);
        can_message["steeringAngle"] = serde_json::json!(steering_angle);
    }

    let _ = app_handle.emit("can-message-received", can_message);

    // 检查是否是雷达消息
    if can_id == "0x00000521" || can_id == "0x00000522" || can_id == "0x00000523" || can_id == "0x00000524" {
        let distance = parse_distance_from_data(&can_data);
        println!("🎯 [I/O Thread] Radar message - ID: {}, Distance: {} mm", can_id, distance);
        info!("🎯 [I/O Thread] Radar message - ID: {}, Distance: {} mm", can_id, distance);
        let radar_message = serde_json::json!({
            "canId": can_id,
            "distance": distance,
            "data": can_data,
            "rawData": raw_hex,
            "timestamp": timestamp,
        });
        let _ = app_handle.emit("radar-message", radar_message);
    }
}

/// 处理解析失败的消息
fn handle_parse_failure(raw_hex: &str, timestamp: &str, app_handle: &tauri::AppHandle) {
    println!("⚠️  [I/O Thread] Failed to parse CAN message, sending raw data");
    info!("⚠️  [I/O Thread] Failed to parse CAN message from raw data: {}", raw_hex);

    let can_message = serde_json::json!({
        "id": "UNKNOWN",
        "data": raw_hex,
        "rawData": raw_hex,
        "timestamp": timestamp,
        "direction": "received",
        "frameType": "unknown",
    });
    let _ = app_handle.emit("can-message-received", can_message);
}

/// 处理消息缓冲区中的完整消息
///
/// 协议格式：固定20字节
/// 处理 Windows 上消息被截断的情况（例如先发 0xAA，再发剩下的 19 字节）
fn process_message_buffer(message_buffer: &mut Vec<u8>, app_handle: &tauri::AppHandle) {
    loop {
        println!("🔄 [I/O Thread] Processing buffer, size: {}", message_buffer.len());

        // 第一步：查找并对齐消息头
        if !find_and_align_message_header(message_buffer) {
            break;
        }

        // 第二步：提取完整的消息（20字节）
        let Some(complete_message) = extract_complete_message(message_buffer) else {
            break;
        };

        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        let raw_hex = complete_message
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" ");

        // 第三步：验证校验和
        if !verify_checksum(&complete_message) {
            println!("⚠️  [I/O Thread] Checksum verification failed, discarding message");
            info!("⚠️  [I/O Thread] Checksum verification failed for message: {}", raw_hex);
            continue;
        }

        // 第四步：解析消息
        if let Some((can_id, can_data, frame_type)) = parse_received_can_message(&complete_message) {
            handle_parsed_can_message(&can_id, &can_data, &frame_type, &raw_hex, &timestamp, app_handle);
        } else {
            handle_parse_failure(&raw_hex, &timestamp, app_handle);
        }

        // 继续处理缓冲区中的下一条消息
        println!("🔄 [I/O Thread] Continuing to process buffer, remaining: {} bytes", message_buffer.len());
    }
}

