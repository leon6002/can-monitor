# CAN Monitor

A cross-platform CAN (Controller Area Network) signal monitoring and transmission tool built with Tauri, React, and Rust.

## Features

### 🔌 Serial Port Management
- **Port Discovery**: Automatically detect all available serial ports on your system
- **Refresh Functionality**: Re-scan for serial ports with a single click
- **Connection Management**: Connect and disconnect from serial ports with configurable baud rates
- **Status Indicators**: Clear visual feedback for connection status and errors

### 📡 CAN Message Communication
- **Send Messages**: Transmit CAN messages through the connected serial port
- **Receive Messages**: Real-time display of incoming CAN messages
- **Dual Format Support**:
  - Standard CAN frames (11-bit identifier)
  - Extended CAN frames (29-bit identifier)
- **Data Validation**: Input validation for CAN IDs and data payloads

### 🔍 Message Filtering
- **Filter Modes**:
  - **None**: Display all messages
  - **Whitelist**: Show only messages matching specified IDs
  - **Blacklist**: Hide messages matching specified IDs
- **Dynamic Rules**: Add, remove, enable/disable filter rules on the fly
- **Real-time Filtering**: Messages are filtered as they arrive

### 📊 Message Log
- **Real-time Display**: Messages appear instantly as they're received
- **Detailed Information**: View timestamp, ID, type (STD/EXT), DLC, and data
- **Auto-scroll**: Optional automatic scrolling to latest messages
- **Export**: Export message log to CSV format
- **Clear History**: Clear all messages with one click

## Technology Stack

- **Desktop Framework**: [Tauri](https://tauri.app/) v2
- **Frontend**: [React](https://react.dev/) 19 with TypeScript
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4
- **Package Manager**: [pnpm](https://pnpm.io/)
- **Backend**: Rust with [serialport](https://crates.io/crates/serialport) crate

## Prerequisites

- Node.js 20.19+ or 22.12+
- Rust 1.70+
- pnpm 8+

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd can-monitor
```

2. Install dependencies:
```bash
pnpm install
```

## Development

Run the application in development mode:

```bash
pnpm tauri dev
```

This will start the Vite development server and launch the Tauri application.

## Building

Build the application for production:

```bash
pnpm tauri build
```

The built application will be available in `src-tauri/target/release/`.

## CAN Message Format

The application expects CAN messages in the following format:

### Standard Frame (11-bit ID)
```
T<ID><DLC><DATA>\r
```
Example: `T1230801020304050607\r` (ID: 0x123, DLC: 8, Data: 01 02 03 04 05 06 07 08)

### Extended Frame (29-bit ID)
```
X<ID><DLC><DATA>\r
```
Example: `X123456780801020304050607\r` (ID: 0x12345678, DLC: 8, Data: 01 02 03 04 05 06 07 08)

## Project Structure

```
can-monitor/
├── src/                      # React frontend source
│   ├── components/          # React components
│   │   ├── ui/             # shadcn/ui components
│   │   ├── SerialPortSelector.tsx
│   │   ├── CANMessageSender.tsx
│   │   ├── CANMessageLog.tsx
│   │   └── CANMessageFilter.tsx
│   ├── store/              # Zustand store
│   │   └── canStore.ts
│   ├── lib/                # Utility functions
│   │   └── utils.ts
│   ├── App.tsx             # Main application component
│   └── main.tsx            # Application entry point
├── src-tauri/              # Tauri/Rust backend
│   ├── src/
│   │   ├── lib.rs         # Main Tauri commands
│   │   └── serial.rs      # Serial port management
│   └── Cargo.toml         # Rust dependencies
└── package.json           # Node.js dependencies
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
