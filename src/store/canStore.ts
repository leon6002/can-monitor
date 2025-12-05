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
  sentMessages: CANMessage[];
  maxMessages: number;

  // Filtering
  filterMode: "none" | "whitelist" | "blacklist" | "block";
  filterRules: FilterRule[];

  // Actions
  setAvailablePorts: (ports: SerialPort[]) => void;
  setSelectedPort: (port: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  setConnectionError: (error: string | null) => void;
  addMessage: (message: CANMessage) => void;
  addMessages: (messages: CANMessage[]) => void; // 批量添加
  clearMessages: () => void;
  addSentMessage: (message: CANMessage) => void;
  clearSentMessages: () => void;
  setMaxMessages: (max: number) => void;
  setFilterMode: (mode: "none" | "whitelist" | "blacklist" | "block") => void;
  shouldBlockMessage: (messageId: string) => boolean; // 检查消息是否应该被屏蔽
  addFilterRule: (rule: FilterRule) => void;
  removeFilterRule: (id: string) => void;
  toggleFilterRule: (id: string) => void;
  updateFilterRule: (id: string, mask: string) => void;
  toggleAllFilterRules: (enabled: boolean) => void;
}

export const useCANStore = create<CANStore>((set) => ({
  // Initial State
  availablePorts: [],
  selectedPort: null,
  isConnected: false,
  connectionError: null,
  messages: [],
  sentMessages: [],
  maxMessages: 80, // 默认只滚动显示80条，减少渲染压力
  filterMode: "none",
  filterRules: [],

  // Actions
  setAvailablePorts: (ports) => set({ availablePorts: ports }),
  setSelectedPort: (port) => set({ selectedPort: port }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setConnectionError: (error) => set({ connectionError: error }),

  addMessage: (message) =>
    set((state) => {
      // Auto-add to filter rules (disabled by default)
      const msgId = message.id.toUpperCase();
      const existingRule = state.filterRules.find((r) => r.mask === msgId);
      let newFilterRules = state.filterRules;

      if (!existingRule) {
        newFilterRules = [
          ...state.filterRules,
          {
            id: crypto.randomUUID(),
            mask: msgId,
            enabled: false,
          },
        ];
      }

      // 如果已经达到最大数量，直接替换最旧的消息（更高效）
      if (state.messages.length >= state.maxMessages) {
        const newMessages = [...state.messages.slice(1), message];
        return { messages: newMessages, filterRules: newFilterRules };
      }

      // 否则直接添加
      return { messages: [...state.messages, message], filterRules: newFilterRules };
    }),

  // 批量添加消息，性能更好
  // 批量添加消息，性能更好
  addMessages: (newMessages) =>
    set((state) => {
      // Auto-add to filter rules (disabled by default)
      const newRules: FilterRule[] = [];
      const existingMasks = new Set(state.filterRules.map((r) => r.mask));

      // Also check against new rules we are about to add to avoid duplicates in the same batch
      const newMasks = new Set<string>();

      newMessages.forEach((msg) => {
        const msgId = msg.id.toUpperCase();
        if (!existingMasks.has(msgId) && !newMasks.has(msgId)) {
          newRules.push({
            id: crypto.randomUUID(),
            mask: msgId,
            enabled: false,
          });
          newMasks.add(msgId);
        }
      });

      const updatedFilterRules = [...state.filterRules, ...newRules];
      const combined = [...state.messages, ...newMessages];

      // Keep only the last maxMessages
      if (combined.length > state.maxMessages) {
        const excess = combined.length - state.maxMessages;
        return { messages: combined.slice(excess), filterRules: updatedFilterRules };
      }

      return { messages: combined, filterRules: updatedFilterRules };
    }),

  clearMessages: () => set({ messages: [] }),

  addSentMessage: (message) =>
    set((state) => {
      if (state.sentMessages.length >= state.maxMessages) {
        const newMessages = [...state.sentMessages.slice(1), message];
        return { sentMessages: newMessages };
      }
      return { sentMessages: [...state.sentMessages, message] };
    }),

  clearSentMessages: () => set({ sentMessages: [] }),

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

  toggleAllFilterRules: (enabled) =>
    set((state) => ({
      filterRules: state.filterRules.map((rule) => ({ ...rule, enabled })),
    })),

  // 检查消息是否应该被屏蔽（在 block 模式下使用）
  shouldBlockMessage: (messageId: string): boolean => {
    const state = useCANStore.getState();

    // 只在 block 模式下屏蔽
    if (state.filterMode !== "block") {
      return false;
    }

    const enabledRules = state.filterRules.filter(
      (rule: FilterRule) => rule.enabled
    );
    if (enabledRules.length === 0) {
      return false;
    }

    const msgId = parseInt(messageId, 16);
    if (isNaN(msgId)) {
      return false;
    }

    // 如果消息 ID 匹配任何启用的规则，则屏蔽
    return enabledRules.some((rule: FilterRule) => {
      const ruleId = parseInt(rule.mask, 16);
      return !isNaN(ruleId) && msgId === ruleId;
    });
  },
}));
