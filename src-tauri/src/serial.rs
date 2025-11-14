use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortInfo {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CANMessage {
    pub id: String,
    pub data: String,
    pub timestamp: u64,
    pub is_extended: bool,
    pub raw_bytes: String, // 原始字节数据（十六进制字符串）
}

pub struct SendMessage {
    pub packet: Vec<u8>,
}

pub struct SerialManager {
    is_connected: bool,
    reader_thread: Option<thread::JoinHandle<()>>,
    should_stop: Arc<AtomicBool>,
    tx_send: Option<mpsc::Sender<SendMessage>>,
}

impl SerialManager {
    pub fn new() -> Self {
        SerialManager {
            is_connected: false,
            reader_thread: None,
            should_stop: Arc::new(AtomicBool::new(false)),
            tx_send: None,
        }
    }

    pub fn connect(
        &mut self,
        port_name: &str,
        baud_rate: u32,
        app: AppHandle,
    ) -> Result<(), String> {
        println!("[SERIAL] 开始连接串口: {} @ {} baud", port_name, baud_rate);

        // Disconnect if already connected
        if self.is_connected {
            println!("[SERIAL] 已有连接，先断开");
            self.disconnect();
        }

        // Open the serial port
        let mut serial_port = serialport::new(port_name, baud_rate)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| {
                let err_msg = format!("Failed to open port: {}", e);
                eprintln!("[SERIAL ERROR] {}", err_msg);
                err_msg
            })?;

        println!("[SERIAL] 串口打开成功");

        // Create channel for sending messages
        let (tx_send, rx_send) = mpsc::channel::<SendMessage>();
        self.tx_send = Some(tx_send);

        println!("[SERIAL] 启动 I/O 线程");

        // Reset stop flag
        self.should_stop.store(false, Ordering::Relaxed);
        let should_stop = Arc::clone(&self.should_stop);

        // Start I/O thread (handles both read and write)
        let reader_thread = thread::spawn(move || {
            println!("[SERIAL THREAD] I/O 线程已启动");
            let mut buffer = vec![0u8; 1024];
            let mut message_buffer = Vec::new(); // 消息缓冲区

            while !should_stop.load(Ordering::Relaxed) {
                // 尝试接收写入请求（非阻塞）
                match rx_send.try_recv() {
                    Ok(msg) => {
                        println!("[SERIAL THREAD] 发送 {} 字节", msg.packet.len());
                        match serial_port.write_all(&msg.packet) {
                            Ok(_) => {
                                if let Err(e) = serial_port.flush() {
                                    eprintln!("[SERIAL THREAD] flush 失败: {}", e);
                                }
                            }
                            Err(e) => {
                                eprintln!("[SERIAL THREAD ERROR] 写入失败: {}", e);
                            }
                        }
                    }
                    Err(mpsc::TryRecvError::Empty) => {
                        // 没有写入请求，尝试读取
                        match serial_port.read(&mut buffer) {
                            Ok(n) if n > 0 => {
                                let received_data = &buffer[..n];
                                println!(
                                    "📥 [SERIAL THREAD] 接收 {} 字节: {:02X?}",
                                    n, received_data
                                );

                                // 将接收到的数据添加到消息缓冲区
                                message_buffer.extend_from_slice(received_data);
                                println!(
                                    "📦 [SERIAL THREAD] 缓冲区大小: {} 字节",
                                    message_buffer.len()
                                );

                                // 处理缓冲区中的消息
                                process_message_buffer(&mut message_buffer, &app);
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
                                eprintln!("[SERIAL THREAD ERROR] 读取错误: {}", e);
                                thread::sleep(Duration::from_millis(10));
                            }
                        }
                    }
                    Err(mpsc::TryRecvError::Disconnected) => {
                        println!("[SERIAL THREAD] 通道断开，退出线程");
                        break;
                    }
                }
            }
            println!("[SERIAL THREAD] I/O 线程已退出");
        });

        self.is_connected = true;
        self.reader_thread = Some(reader_thread);

        println!("[SERIAL] ✓ 连接成功，等待接收数据...");
        Ok(())
    }

    pub fn disconnect(&mut self) {
        println!("[SERIAL] 开始断开连接");

        // Signal the reader thread to stop
        self.should_stop.store(true, Ordering::Relaxed);
        println!("[SERIAL] 已发送停止信号");

        self.is_connected = false;

        // Drop the sender to signal the thread
        self.tx_send = None;
        println!("[SERIAL] 通道已关闭");

        // Wait for the reader thread to exit
        if let Some(thread) = self.reader_thread.take() {
            println!("[SERIAL] 等待 I/O 线程退出...");
            thread::sleep(Duration::from_millis(200));
            let _ = thread.join();
            println!("[SERIAL] I/O 线程已退出");
        }

        println!("[SERIAL] ✓ 断开连接完成");
    }

    pub fn is_connected(&self) -> bool {
        self.is_connected
    }

    pub fn send_can_message(&self, id: &str, data: &str, is_extended: bool) -> Result<(), String> {
        println!(
            "[SERIAL] 准备发送 CAN 消息: ID={}, Data={}, Extended={}",
            id, data, is_extended
        );

        if !self.is_connected {
            eprintln!("[SERIAL ERROR] 未连接到串口");
            return Err("Not connected to serial port".to_string());
        }

        let tx_send = self
            .tx_send
            .as_ref()
            .ok_or("Send channel not available".to_string())?;

        // 创建固定20字节协议数据包
        let packet = Self::create_can_send_packet_fixed(id, data, is_extended).map_err(|e| {
            let err_msg = format!("Failed to create CAN packet: {}", e);
            eprintln!("[SERIAL ERROR] {}", err_msg);
            err_msg
        })?;

        let bytes: Vec<String> = packet.iter().map(|b| format!("{:02X}", b)).collect();
        println!("[SERIAL] 发送字节 (固定20字节): {}", bytes.join(" "));

        tx_send.send(SendMessage { packet }).map_err(|e| {
            let err_msg = format!("Failed to send message through channel: {}", e);
            eprintln!("[SERIAL ERROR] {}", err_msg);
            err_msg
        })?;

        println!("[SERIAL] ✓ 消息已加入发送队列");
        Ok(())
    }

    /// 创建 CAN 发送数据包（固定20字节协议）
    ///
    /// 协议格式（固定20字节）：
    /// - 字节0: 0xAA (数据包报头)
    /// - 字节1: 0x55 (数据包报头)
    /// - 字节2: 0x01 (类型)
    /// - 字节3: 0x01=标准帧, 0x02=扩展帧 (帧类型)
    /// - 字节4: 0x01 (帧格式，数据帧)
    /// - 字节5-8: CAN ID (4字节，小端序)
    /// - 字节9: 数据长度 (0-8)
    /// - 字节10-17: CAN 数据 (8字节，不足补0)
    /// - 字节18: 0x00 (保留)
    /// - 字节19: 校验码 (从字节2到字节18的累加和低8位)
    fn create_can_send_packet_fixed(
        id: &str,
        data: &str,
        is_extended: bool,
    ) -> Result<Vec<u8>, String> {
        // 解析 CAN ID
        let id_clean = id.trim_start_matches("0x").trim_start_matches("0X");
        let can_id =
            u32::from_str_radix(id_clean, 16).map_err(|e| format!("Invalid CAN ID: {}", e))?;

        // 验证 ID 范围
        if !is_extended && can_id > 0x7FF {
            return Err("Standard CAN ID must be <= 0x7FF".to_string());
        }
        if is_extended && can_id > 0x1FFFFFFF {
            return Err("Extended CAN ID must be <= 0x1FFFFFFF".to_string());
        }

        // 解析数据字节
        let data_clean = data.replace(" ", "").replace("\n", "").replace("\r", "");
        if data_clean.len() % 2 != 0 {
            return Err("Data must have even number of hex digits".to_string());
        }

        let data_len = data_clean.len() / 2;
        if data_len > 8 {
            return Err("Data length must be <= 8 bytes".to_string());
        }

        let mut data_bytes = Vec::new();
        for i in 0..data_len {
            let byte_str = &data_clean[i * 2..i * 2 + 2];
            let byte = u8::from_str_radix(byte_str, 16)
                .map_err(|e| format!("Invalid data byte: {}", e))?;
            data_bytes.push(byte);
        }

        // 补齐到8字节
        while data_bytes.len() < 8 {
            data_bytes.push(0x00);
        }

        // 构建数据包
        let mut packet = Vec::new();

        // 字节0-1: 数据包报头
        packet.push(0xAA);
        packet.push(0x55);

        // 字节2: 类型
        packet.push(0x01);

        // 字节3: 帧类型 (0x01=标准帧, 0x02=扩展帧)
        let frame_type_byte = if is_extended { 0x02 } else { 0x01 };
        packet.push(frame_type_byte);

        // 字节4: 帧格式 (0x01=数据帧)
        packet.push(0x01);

        // 字节5-8: CAN ID (4字节，小端序)
        let id_bytes = can_id.to_le_bytes();
        packet.extend_from_slice(&id_bytes);

        // 字节9: 数据长度
        packet.push(data_len as u8);

        // 字节10-17: CAN 数据 (8字节)
        packet.extend_from_slice(&data_bytes);

        // 字节18: 保留
        packet.push(0x00);

        // 字节19: 校验码 (从字节2到字节18的累加和低8位)
        let checksum: u8 = packet[2..].iter().map(|&b| b as u32).sum::<u32>() as u8;
        packet.push(checksum);

        println!("[SERIAL] 固定20字节数据包: {:02X?}", packet);
        println!("[SERIAL] 数据包长度: {} 字节", packet.len());

        Ok(packet)
    }

    #[allow(dead_code)]
    pub fn parse_can_message(line: &str) -> Option<CANMessage> {
        // Parse CAN message from serial data
        // Expected format: "T<ID><DLC><DATA>" or "X<ID><DLC><DATA>"
        println!("[PARSE] 输入字符串长度: {}, 内容: {:?}", line.len(), line);

        if line.len() < 5 {
            println!("[PARSE] ✗ 字符串太短 (< 5)");
            return None;
        }

        let first_char = line.chars().next().unwrap();
        let is_extended = first_char == 'X';

        println!(
            "[PARSE] 首字符: '{}', 是否扩展帧: {}",
            first_char, is_extended
        );

        if first_char != 'T' && !is_extended {
            println!("[PARSE] ✗ 首字符不是 'T' 或 'X'");
            return None;
        }

        // Parse ID (3 hex digits for standard, 8 for extended)
        let id_len = if is_extended { 8 } else { 3 };
        println!("[PARSE] ID 长度应为: {}", id_len);

        if line.len() < 1 + id_len {
            println!("[PARSE] ✗ 字符串太短，无法包含完整 ID");
            return None;
        }

        let id = &line[1..1 + id_len];
        println!("[PARSE] ID: {:?}", id);

        // Parse DLC (1 digit)
        let dlc_pos = 1 + id_len;
        if line.len() <= dlc_pos {
            println!("[PARSE] ✗ 字符串太短，无法包含 DLC");
            return None;
        }

        let dlc_char = &line[dlc_pos..dlc_pos + 1];
        println!("[PARSE] DLC: {:?}", dlc_char);

        // Parse data
        let data_start = dlc_pos + 1;
        let data = if line.len() > data_start {
            &line[data_start..]
        } else {
            ""
        };

        println!("[PARSE] Data: {:?}", data);

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        println!("[PARSE] ✓ 解析成功");

        Some(CANMessage {
            id: id.to_string(),
            data: data.to_string(),
            timestamp,
            is_extended,
            raw_bytes: line.to_string(), // 保存原始文本
        })
    }
}

/// 处理消息缓冲区，解析二进制 CAN 消息
///
/// 固定20字节协议格式：
/// - 字节0: 0xAA (数据包报头)
/// - 字节1: 0x55 (数据包报头)
/// - 字节2: 0x01 (类型)
/// - 字节3: 0x01=标准帧, 0x02=扩展帧
/// - 字节4: 0x01=数据帧
/// - 字节5-8: CAN ID (4字节，小端序)
/// - 字节9: 数据长度 (0-8)
/// - 字节10-17: CAN 数据 (8字节，不足补0)
/// - 字节18: 0x00 (保留)
/// - 字节19: 校验码 (字节2-18的累加和低8位)
fn process_message_buffer(message_buffer: &mut Vec<u8>, app_handle: &AppHandle) {
    const FIXED_PACKET_LEN: usize = 20;

    loop {
        println!("🔄 [PARSE] 处理缓冲区，大小: {}", message_buffer.len());

        // 查找固定协议的起始标志 0xAA 0x55
        let mut start_pos = None;
        for i in 0..message_buffer.len().saturating_sub(1) {
            if message_buffer[i] == 0xAA && message_buffer[i + 1] == 0x55 {
                start_pos = Some(i);
                break;
            }
        }

        if let Some(start) = start_pos {
            // 丢弃起始标志之前的数据
            if start > 0 {
                println!("⚠️  [PARSE] 丢弃起始标志前的 {} 字节", start);
                message_buffer.drain(0..start);
            }

            // 检查是否有完整的20字节数据包
            if message_buffer.len() < FIXED_PACKET_LEN {
                println!(
                    "⏳ [PARSE] 等待更多数据（有 {} 字节，需要 {} 字节）",
                    message_buffer.len(),
                    FIXED_PACKET_LEN
                );
                break;
            }

            // 提取完整的20字节数据包
            let packet: Vec<u8> = message_buffer.drain(0..FIXED_PACKET_LEN).collect();

            let raw_hex = packet
                .iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join(" ");

            println!("� [PARSE] 提取20字节数据包: {}", raw_hex);

            // 验证数据包格式
            if packet[0] != 0xAA || packet[1] != 0x55 {
                println!(
                    "❌ [PARSE] 数据包报头错误: {:02X} {:02X} (期望 AA 55)",
                    packet[0], packet[1]
                );
                continue;
            }

            if packet[2] != 0x01 {
                println!("❌ [PARSE] 类型字节错误: 0x{:02X} (期望 0x01)", packet[2]);
                continue;
            }

            // 验证校验码
            let checksum: u8 = packet[2..19].iter().map(|&b| b as u32).sum::<u32>() as u8;
            if packet[19] != checksum {
                println!(
                    "❌ [PARSE] 校验码错误: 0x{:02X} (期望 0x{:02X})",
                    packet[19], checksum
                );
                continue;
            }

            // 解析帧类型
            let frame_type = packet[3];
            let is_extended = frame_type == 0x02;

            println!(
                "🔍 [PARSE] 帧类型: 0x{:02X} ({})",
                frame_type,
                if is_extended {
                    "扩展帧"
                } else {
                    "标准帧"
                }
            );

            // 解析 CAN ID (小端序，4字节)
            let can_id = (packet[5] as u32)
                | ((packet[6] as u32) << 8)
                | ((packet[7] as u32) << 16)
                | ((packet[8] as u32) << 24);

            println!("🔍 [PARSE] CAN ID: 0x{:X}", can_id);

            // 解析数据长度
            let data_len = packet[9] as usize;
            if data_len > 8 {
                println!("❌ [PARSE] 数据长度错误: {} (最大8)", data_len);
                continue;
            }

            println!("🔍 [PARSE] 数据长度: {}", data_len);

            // 提取 CAN 数据（只取实际长度，不包含填充的0）
            let can_data = packet[10..10 + data_len]
                .iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join("");

            println!("🔍 [PARSE] CAN 数据: {}", can_data);

            // 创建 CAN 消息
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            let message = CANMessage {
                id: format!("0x{:X}", can_id),
                data: can_data,
                timestamp,
                is_extended,
                raw_bytes: raw_hex,
            };

            println!(
                "✅ [PARSE] 解析成功: ID={}, Data={}, Extended={}",
                message.id, message.data, message.is_extended
            );

            // 发送到前端
            match app_handle.emit("can-message", message) {
                Ok(_) => println!("✅ [PARSE] 消息已发送到前端"),
                Err(e) => eprintln!("❌ [PARSE ERROR] 发送到前端失败: {}", e),
            }

            // 继续处理缓冲区中的下一条消息
        } else {
            // 没有找到起始标志
            println!("⏳ [PARSE] 未找到起始标志 AA 55");
            break;
        }
    }
}
