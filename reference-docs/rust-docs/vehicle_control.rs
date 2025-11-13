use serde::{Deserialize, Serialize};

/// 结构体用于存储解析后的控制数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleControl {
    /// 车体行进速度，单位 mm/s (Signed Int16)
    pub linear_velocity_mms: i16,
    /// 转向角度
    pub steering_angle: f32,
    /// 档位 (0=disable, 1=P, 2=R, 3=N, 4=D)
    pub gear: u8,
    /// 档位名称 (disable/P/R/N/D)
    pub gear_name: String,
}

/// 解析 8 字节的十六进制数据，转换为车速和转向角。
///
/// 协议:
/// data[0-2] (小端序): 速度值 (20位) + 档位 (4位)
///   - 低4位 (data[0] & 0x0F): 档位 (4=D档)
///   - 高20位: 速度值 (mm/s)
/// data[3-4] (小端序, 16位补码): 转向角 (0.01度/count)
/// data[6-7]: 保留
///
/// # Arguments
/// * `data`: 包含 8 字节控制数据的数组。
///
/// # Returns
/// * `Result<VehicleControl, &'static str>`: 成功时返回 VehicleControl 结构体，
///   失败时返回错误信息（如果输入数据长度不正确）。
pub fn parse_control_data_4byte(data: &[u8]) -> Result<VehicleControl, &'static str> {
    // 检查输入数据长度是否至少为 8 字节
    if data.len() < 8 {
        return Err("输入数据长度必须至少是 8 字节");
    }

    // 0. 解析档位 (data[0]的低4位)
    let gear = data[0] & 0x0F;
    let gear_name = match gear {
        0x00 => "disable".to_string(),
        0x01 => "P".to_string(),
        0x02 => "R".to_string(),
        0x03 => "N".to_string(),
        0x04 => "D".to_string(),
        _ => "Unknown".to_string(),
    };

    // 1. 解析速度 (data[0-2], 小端序)
    // 取前3个字节，转换为小端序的u32
    // let speed_raw = u32::from_le_bytes([data[0], data[1], data[2], 0]);
    // 高20位是速度值，低4位是档位
    let speed_high_byte = ((data[2] & 0x0F) << 4) | ((data[1] >> 4) & 0x0F);
    let speed_low_byte = ((data[1] & 0x0F) << 4) | ((data[0] >> 4) & 0x0F);
    let linear_velocity_mms = i16::from_be_bytes([speed_high_byte, speed_low_byte]);
    // 2. 解析转向角 (data[2-4], 16位补码)
    // 取字节2-4（00 9C 0F），小端序读取为 0F 9C 00
    // 去掉首尾半个字节，得到 F9C0 = -1600 (16位补码)
    // 从 0F 9C 00 中提取 F9C0：
    // - 0F 的低4位 F 作为高字节的高4位
    // - 9C 作为高字节的低4位和低字节的高4位
    // - 00 的高4位 0 作为低字节的低4位
    let high_byte = ((data[4] & 0x0F) << 4) | ((data[3] >> 4) & 0x0F);
    let low_byte = ((data[3] & 0x0F) << 4) | ((data[2] >> 4) & 0x0F);
    let steering_angle_raw = i16::from_be_bytes([high_byte, low_byte]);

    // 3. 转换转向角单位: 从 0.01度 计数转换为 rad
    // 0.01度 = 0.01 * π/180 rad ≈ 0.0001745 rad
    let steering_angle = steering_angle_raw as f32 * 0.01;

    // 4. 返回解析结果
    Ok(VehicleControl {
        linear_velocity_mms,
        steering_angle,
        gear,
        gear_name,
    })
}

/// 从十六进制字符串解析 CAN 数据
/// 支持格式: "0B B8 FF 07" 或 "0BB8FF07"
pub fn parse_can_data_hex(hex_str: &str) -> Result<Vec<u8>, &'static str> {
    let cleaned = hex_str.replace(" ", "").replace("0x", "").replace("0X", "");
    
    if cleaned.len() % 2 != 0 {
        return Err("十六进制字符串长度必须是偶数");
    }

    cleaned
        .as_bytes()
        .chunks(2)
        .map(|chunk| {
            let hex_str = std::str::from_utf8(chunk)
                .map_err(|_| "Failed to convert byte chunk to string")?;
            u8::from_str_radix(hex_str, 16)
                .map_err(|_| "Invalid hex character")
        })
        .collect()
}

/// 从 CAN 数据字符串提取车速和转向角
pub fn extract_vehicle_control(can_data: &str) -> Result<VehicleControl, String> {
    let data_bytes = parse_can_data_hex(can_data)
        .map_err(|e| format!("Failed to parse CAN data: {}", e))?;
    
    parse_control_data_4byte(&data_bytes)
        .map_err(|e| format!("Failed to parse control data: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_control_data_8byte() {
        // 测试数据: 04 4B 00 9C 0F 00 A0 7C
        // 速度: 04 4B 00 (小端序) -> 0x004B04 >> 4 = 0x004B0 = 1200 mm/s
        // 转向角: 9C 0F -> 交换为 0F 9C -> 0xF9C0 = -1600 (16位补码) * 0.01 = -16度
        // let hex_data: [u8; 8] = [0x04, 0x4B, 0x00, 0x9C, 0x0F, 0x00, 0xA0, 0x7C];
        let hex_data: [u8; 8] = [0x84, 0xBB, 0x20, 0x00, 0x00, 0x00, 0xD0, 0xCF];
        match parse_control_data_4byte(&hex_data) {
            Ok(control) => {
                println!("成功解析 8 字节控制数据:");
                println!("  原始十六进制数据: {:02X?}", hex_data);
                println!("  线速度 (mm/s): {}", control.linear_velocity_mms);
                println!("  转向角 (度):   {:.2}", control.steering_angle);

                // 验证速度: 0x004B04 >> 4 = 0x004B0 = 1200
                assert_eq!(control.linear_velocity_mms, 1200);
                // 验证转向角: -1600 * 0.01度 = -16度 ≈ -0.279253 rad
                let expected_angle_rad = -16.0 * std::f32::consts::PI / 180.0;
                assert!((control.steering_angle - expected_angle_rad).abs() < 0.0001);
            }
            Err(e) => {
                panic!("解析失败: {}", e);
            }
        }
    }

    #[test]
    fn test_parse_can_data_hex() {
        let hex_str = "04 4B 00 9C 0F 00 A0 7C";
        let result = parse_can_data_hex(hex_str).unwrap();
        assert_eq!(result, vec![0x04, 0x4B, 0x00, 0x9C, 0x0F, 0x00, 0xA0, 0x7C]);

        let hex_str2 = "044B009C0F00A07C";
        let result2 = parse_can_data_hex(hex_str2).unwrap();
        assert_eq!(result2, vec![0x04, 0x4B, 0x00, 0x9C, 0x0F, 0x00, 0xA0, 0x7C]);
    }
}

