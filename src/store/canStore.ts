import { create } from "zustand";

export interface CANMessage {
  id: string;
  data: string;
  timestamp: number;
  isExtended: boolean;
  rawBytes: string; // 原始字节数据
}

export interface SerialPort {
  name: string;
  path: string;
}

export interface FilterRule {
  id: string;
  mask: string;
  enabled: boolean;
}

interface CANStore {
  // Serial Port State
  availablePorts: SerialPort[];
  selectedPort: string | null;
  isConnected: boolean;
  connectionError: string | null;

  // CAN Messages
  messages: CANMessage[];
  maxMessages: number;

  // Filtering
  filterMode: "none" | "whitelist" | "blacklist";
  filterRules: FilterRule[];

  // Actions
  setAvailablePorts: (ports: SerialPort[]) => void;
  setSelectedPort: (port: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  setConnectionError: (error: string | null) => void;
  addMessage: (message: CANMessage) => void;
  clearMessages: () => void;
  setMaxMessages: (max: number) => void;
  setFilterMode: (mode: "none" | "whitelist" | "blacklist") => void;
  addFilterRule: (rule: FilterRule) => void;
  removeFilterRule: (id: string) => void;
  toggleFilterRule: (id: string) => void;
  updateFilterRule: (id: string, mask: string) => void;
}

export const useCANStore = create<CANStore>((set) => ({
  // Initial State
  availablePorts: [],
  selectedPort: null,
  isConnected: false,
  connectionError: null,
  messages: [],
  maxMessages: 500, // 默认最多500条
  filterMode: "none",
  filterRules: [],

  // Actions
  setAvailablePorts: (ports) => set({ availablePorts: ports }),
  setSelectedPort: (port) => set({ selectedPort: port }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setConnectionError: (error) => set({ connectionError: error }),

  addMessage: (message) =>
    set((state) => {
      const newMessages = [...state.messages, message];
      // Keep only the last maxMessages
      if (newMessages.length > state.maxMessages) {
        newMessages.shift();
      }
      return { messages: newMessages };
    }),

  clearMessages: () => set({ messages: [] }),

  setMaxMessages: (max) => set({ maxMessages: max }),

  setFilterMode: (mode) => set({ filterMode: mode }),

  addFilterRule: (rule) =>
    set((state) => ({
      filterRules: [...state.filterRules, rule],
    })),

  removeFilterRule: (id) =>
    set((state) => ({
      filterRules: state.filterRules.filter((rule) => rule.id !== id),
    })),

  toggleFilterRule: (id) =>
    set((state) => ({
      filterRules: state.filterRules.map((rule) =>
        rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
      ),
    })),

  updateFilterRule: (id, mask) =>
    set((state) => ({
      filterRules: state.filterRules.map((rule) =>
        rule.id === id ? { ...rule, mask } : rule
      ),
    })),
}));
