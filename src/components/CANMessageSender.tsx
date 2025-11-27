import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCANStore } from "@/store/canStore";
import { useProjectStore } from "@/store/projectStore";
import { Send, Plus, Trash2, Square, Radio, FileUp, ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";

interface CANMessageItem {
  id: string;
  canId: string;
  data: string;
  isExtended: boolean;
  selected: boolean;
  name?: string; // 消息名称/备注
  group?: string; // 分组名称
}

interface CSVMessageItem {
  canId: string;
  data: string;
  isExtended: boolean;
  interval: number;
}

// Debounced Input Component
function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 3000,
  ...props
}: {
  value: string | number;
  onChange: (value: string | number) => void;
  debounce?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (value !== initialValue) {
        onChange(value);
      }
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value, debounce, initialValue, onChange]);

  return (
    <Input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initialValue) {
          onChange(value);
        }
      }}
    />
  );
}

export function CANMessageSender() {
  const isConnected = useCANStore((state) => state.isConnected);
  const addSentMessage = useCANStore((state) => state.addSentMessage);
  const { currentProject, updateProject } = useProjectStore();

  // 消息列表 - 从项目加载或使用默认值
  const [messages, setMessages] = useState<CANMessageItem[]>(() => {
    if (currentProject?.messageTemplates) {
      return currentProject.messageTemplates;
    }
    return [
      {
        id: crypto.randomUUID(),
        canId: "000",
        data: "00",
        isExtended: false,
        selected: true,
      },
    ];
  });

  // 发送控制
  const [isSending, setIsSending] = useState(false);
  const [sendMode, setSendMode] = useState<"next" | "all" | "loop" | "csv">("next");
  const [loopInterval, setLoopInterval] = useState("100");
  const [sentCount, setSentCount] = useState(0);

  // CSV 发送相关状态
  const [csvSequence, setCsvSequence] = useState<CSVMessageItem[]>([]);
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [csvTotal, setCsvTotal] = useState(0);
  const [csvCurrent, setCsvCurrent] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Grouping State
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Initialize expanded state for new groups
  useEffect(() => {
    const groups = new Set(messages.map(m => m.group || "ungrouped"));
    setExpandedGroups(prev => {
      const next = { ...prev };
      groups.forEach(g => {
        if (next[g] === undefined) next[g] = true; // Default open
      });
      return next;
    });
  }, [messages]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const sendTimerRef = useRef<number | null>(null);
  const currentIndexRef = useRef(0); // 用于跟踪下一条要发送的消息
  const isSendingRef = useRef(false); // Ref to track sending status for async closures

  // Sync isSending state to ref
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  // 从项目加载消息模板
  useEffect(() => {
    if (currentProject?.messageTemplates) {
      setMessages(currentProject.messageTemplates);
    }
  }, [currentProject?.id]);

  // 自动保存消息到项目（10秒防抖）
  useEffect(() => {
    if (currentProject && currentProject.projectPath) {
      const saveTimer = setTimeout(() => {
        console.log("[CANMessageSender] Auto-saving messages to project...");

        const updatedProject = {
          ...currentProject,
          messageTemplates: messages,
          updatedAt: Date.now(),
        };

        // 先更新 store
        updateProject({ messageTemplates: messages });

        // 再保存到文件
        invoke("save_project_to_file", {
          projectJson: JSON.stringify(updatedProject, null, 2),
          filePath: currentProject.projectPath,
        })
          .then(() => {
            console.log("[CANMessageSender] ✓ Messages saved to project");
          })
          .catch((err) => {
            console.error("[CANMessageSender] ✗ Failed to save project:", err);
          });
      }, 10000); // 10秒防抖

      return () => clearTimeout(saveTimer);
    }
  }, [messages, currentProject?.id, currentProject?.projectPath]);

  // 当选中的消息变化时，重置索引
  useEffect(() => {
    currentIndexRef.current = 0;
  }, [messages.filter((msg) => msg.selected).length]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (sendTimerRef.current) {
        clearInterval(sendTimerRef.current);
      }
    };
  }, []);

  // 验证消息
  const validateMessage = (
    id: string,
    data: string,
    extended: boolean
  ): string | null => {
    if (!id) return "CAN ID is required";

    const idNum = parseInt(id, 16);
    if (isNaN(idNum)) return "Invalid CAN ID (must be hexadecimal)";

    if (!extended && idNum > 0x7ff) return "Standard CAN ID must be <= 0x7FF";
    if (extended && idNum > 0x1fffffff)
      return "Extended CAN ID must be <= 0x1FFFFFFF";

    const dataClean = data.replace(/\s/g, "");
    if (dataClean.length > 0) {
      const invalidCharMatch = dataClean.match(/[^0-9A-Fa-f]/);
      if (invalidCharMatch) {
        const invalidChar = invalidCharMatch[0];
        const position = invalidCharMatch.index! + 1;
        return `Invalid character '${invalidChar}' at position ${position}. Only 0-9, A-F allowed.`;
      }
    }

    if (dataClean.length % 2 !== 0)
      return "Data must have an even number of hex digits";
    if (dataClean.length > 16) return "Data must be <= 8 bytes (16 hex digits)";

    return null;
  };

  // 发送单条消息
  const sendMessage = async (id: string, data: string, extended: boolean) => {
    const dataClean = data.replace(/\s/g, "");
    await invoke("send_can_message", {
      id,
      data: dataClean,
      isExtended: extended,
    });

    // Record sent message
    addSentMessage({
      id: id.toUpperCase(),
      data: dataClean.toUpperCase(),
      isExtended: extended,
      timestamp: Date.now(),
      rawBytes: "", // Not needed for sent messages or can be formatted from data
    });
  };

  // 添加消息到列表（使用默认值）
  const handleAddMessage = () => {
    const defaultId = "000";
    const defaultData = "00";

    const newMessage: CANMessageItem = {
      id: crypto.randomUUID(),
      canId: defaultId,
      data: defaultData,
      isExtended: false,
      selected: true, // 默认选中
      name: "", // 默认空名称
    };

    setMessages((prev) => [...prev, newMessage]);
    toast.success(`Added message #${messages.length + 1}`);
  };

  // 删除消息
  const handleRemoveMessage = (id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  };

  // 切换选中状态
  const toggleSelect = (id: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, selected: !msg.selected } : msg
      )
    );
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    const allSelected = messages.every((msg) => msg.selected);
    setMessages((prev) =>
      prev.map((msg) => ({ ...msg, selected: !allSelected }))
    );
  };

  // 编辑消息
  const handleEditMessage = (
    id: string,
    field: "canId" | "data" | "name" | "group",
    value: string
  ) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, [field]: value } : msg))
    );
  };

  // 切换扩展帧
  const toggleExtended = (id: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, isExtended: !msg.isExtended } : msg
      )
    );
  };

  // 发送选中的消息
  const handleSendSelected = async () => {
    const selected = messages.filter((msg) => msg.selected);
    if (selected.length === 0) {
      toast.error("No messages selected");
      return;
    }

    // 验证所有选中的消息
    for (const msg of selected) {
      const error = validateMessage(msg.canId, msg.data, msg.isExtended);
      if (error) {
        toast.error(`Message ${msg.canId}: ${error}`);
        return;
      }
    }

    if (sendMode === "next") {
      // 轮流发送：每次点击发送下一条选中的消息
      try {
        const msg = selected[currentIndexRef.current];
        await sendMessage(msg.canId, msg.data, msg.isExtended);

        const msgName = msg.name ? `"${msg.name}"` : `ID ${msg.canId}`;
        toast.success(
          `Sent ${msgName} (${currentIndexRef.current + 1}/${selected.length})`
        );

        // 移动到下一条消息（循环）
        currentIndexRef.current =
          (currentIndexRef.current + 1) % selected.length;
        setSentCount((prev) => prev + 1);
      } catch (err) {
        toast.error(`Failed: ${err}`);
      }
      return;
    }

    setIsSending(true);
    setSentCount(0);

    if (sendMode === "all") {
      // 一次性发送所有选中的消息
      try {
        for (const msg of selected) {
          await sendMessage(msg.canId, msg.data, msg.isExtended);
          setSentCount((prev) => prev + 1);
        }
        toast.success(`Sent ${selected.length} messages`);
      } catch (err) {
        toast.error(`Failed: ${err}`);
      } finally {
        setIsSending(false);
      }
    } else {
      // 循环发送
      const interval = parseInt(loopInterval);
      if (isNaN(interval) || interval < 10) {
        toast.error("Interval must be >= 10ms");
        setIsSending(false);
        return;
      }

      currentIndexRef.current = 0;
      sendTimerRef.current = window.setInterval(async () => {
        try {
          const msg = selected[currentIndexRef.current];
          await sendMessage(msg.canId, msg.data, msg.isExtended);
          setSentCount((prev) => prev + 1);
          currentIndexRef.current =
            (currentIndexRef.current + 1) % selected.length;
        } catch (err) {
          console.error("Loop send error:", err);
        }
      }, interval);

      toast.success("Loop started");
    }
  };

  // 停止发送
  const handleStopSending = () => {
    if (sendTimerRef.current) {
      clearInterval(sendTimerRef.current); // Works for setInterval
      clearTimeout(sendTimerRef.current);  // Works for setTimeout
      sendTimerRef.current = null;
    }
    setIsSending(false);
    toast.success(`Stopped (sent ${sentCount} messages)`);
  };

  // 解析 CSV 内容
  const parseCSV = (content: string): CSVMessageItem[] => {
    const lines = content.split(/\r?\n/);
    const result: CSVMessageItem[] = [];

    // 跳过标题行 (假设第一行是标题)
    const startIndex = lines[0].toLowerCase().includes("id") ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(",");
      if (parts.length < 3) continue;

      // 1. ID: 去掉 0x, 转大写
      let idStr = parts[0].trim().replace(/^0x/i, "").toUpperCase();

      // 2. Type: std/ext
      const typeStr = parts[1].trim().toLowerCase();
      const isExtended = typeStr === "ext";

      // 3. Data: 去掉空格, 转大写
      const dataStr = parts[2].trim().replace(/\s/g, "").toUpperCase();

      // 4. Interval: 默认 1000ms
      let interval = 1000;
      if (parts.length > 3) {
        const intervalStr = parts[3].trim();
        if (intervalStr) {
          const parsed = parseInt(intervalStr);
          if (!isNaN(parsed) && parsed > 0) {
            interval = parsed;
          }
        }
      }

      result.push({
        canId: idStr,
        data: dataStr,
        isExtended,
        interval
      });
    }
    return result;
  };

  // 处理文件上传
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const parsed = parseCSV(content);
        setCsvSequence(parsed);
        setCsvTotal(parsed.length);
        setCsvCurrent(0);
        toast.success(`Loaded ${parsed.length} messages from CSV`);
      } catch (err) {
        toast.error("Failed to parse CSV file");
        console.error(err);
      }
    };
    reader.readAsText(file);
    // 清空 input value，允许重复选择同一文件
    event.target.value = "";
  };

  // 开始 CSV 序列发送
  const handleSendCsv = async () => {
    if (csvSequence.length === 0) {
      toast.error("No CSV messages loaded");
      return;
    }

    setIsSending(true);
    isSendingRef.current = true; // Immediately update ref to allow processSequence to start
    setSentCount(0);
    setCsvCurrent(0);
    currentIndexRef.current = 0;

    const processSequence = async (index: number) => {
      // Check if stopped
      if (!isSendingRef.current) return;

      if (index >= csvSequence.length) {
        setIsSending(false);
        toast.success("CSV sequence completed");
        return;
      }

      const item = csvSequence[index];
      try {
        await sendMessage(item.canId, item.data, item.isExtended);

        // Check if stopped during await
        if (!isSendingRef.current) return;

        setSentCount(prev => prev + 1);
        setCsvCurrent(index + 1);

        // 准备发送下一条
        if (index + 1 < csvSequence.length) {
          const timerId = window.setTimeout(() => {
            processSequence(index + 1);
          }, item.interval);

          sendTimerRef.current = timerId;
        } else {
          setIsSending(false);
          toast.success("CSV sequence completed");
        }
      } catch (err) {
        toast.error(`Error sending line ${index + 1}: ${err}`);
        setIsSending(false);
      }
    };

    // 开始第一条
    processSequence(0);
  };

  const selectedCount = messages.filter((msg) => msg.selected).length;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Radio className="w-4 h-4" />
          Send Message
          {isSending && sendMode === "loop" && (
            <Badge variant="default" className="text-xs bg-green-600">
              {sentCount} sent
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden flex flex-col gap-3 p-4">
        {/* 消息列表 */}
        <div className="flex-1 overflow-hidden flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">
              Messages ({messages.length})
              {selectedCount > 0 && (
                <span className="text-primary">
                  {" "}
                  • {selectedCount} selected
                </span>
              )}
            </Label>
            <div className="flex gap-1">
              {messages.length > 0 && (
                <>
                  <Button
                    onClick={toggleSelectAll}
                    disabled={isSending}
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                  >
                    {messages.every((msg) => msg.selected)
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                  <Button
                    onClick={() => {
                      setMessages([
                        {
                          id: crypto.randomUUID(),
                          canId: "000",
                          data: "00",
                          isExtended: false,
                          selected: true,
                        },
                      ]);
                      toast.success("List cleared");
                    }}
                    disabled={isSending}
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto border rounded-md p-2 bg-background space-y-1">
            {/* Ungrouped Messages */}
            {messages.filter(m => !m.group).map((msg) => (
              <div
                key={msg.id}
                className={`p-2 rounded border space-y-1.5 ${msg.selected ? "bg-primary/10 border-primary" : "bg-muted/30"
                  }`}
              >
                {/* 第一行：序号、名称、分组、删除按钮 */}
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={msg.selected}
                    onCheckedChange={() => toggleSelect(msg.id)}
                    disabled={isSending}
                  />
                  <Badge
                    variant="outline"
                    className="text-xs h-5 w-6 flex-shrink-0"
                  >
                    {messages.indexOf(msg) + 1}
                  </Badge>
                  <Input
                    value={msg.name || ""}
                    onChange={(e) =>
                      handleEditMessage(msg.id, "name", e.target.value)
                    }
                    disabled={isSending}
                    placeholder="Message name..."
                    className="h-6 text-xs flex-1 min-w-[80px]"
                  />
                  <DebouncedInput
                    value={msg.group || ""}
                    onChange={(val) =>
                      handleEditMessage(msg.id, "group", val.toString())
                    }
                    disabled={isSending}
                    placeholder="Group..."
                    className="h-6 text-xs w-20 text-muted-foreground"
                  />
                  <Button
                    onClick={() => handleRemoveMessage(msg.id)}
                    disabled={isSending}
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-destructive/20 flex-shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>

                {/* 第二行：ID、类型、数据 */}
                <div className="flex items-center gap-2 pl-8">
                  <Input
                    value={msg.canId}
                    onChange={(e) =>
                      handleEditMessage(
                        msg.id,
                        "canId",
                        e.target.value.toUpperCase()
                      )
                    }
                    disabled={isSending}
                    maxLength={msg.isExtended ? 8 : 3}
                    placeholder="ID"
                    className="font-mono h-6 text-xs w-20"
                  />
                  <Button
                    onClick={() => toggleExtended(msg.id)}
                    disabled={isSending}
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                  >
                    {msg.isExtended ? "EXT" : "STD"}
                  </Button>
                  <Input
                    value={msg.data}
                    onChange={(e) =>
                      handleEditMessage(
                        msg.id,
                        "data",
                        e.target.value.toUpperCase()
                      )
                    }
                    disabled={isSending}
                    placeholder="Data (hex)"
                    className="font-mono h-6 text-xs flex-1"
                  />
                </div>
              </div>
            ))}

            {/* Grouped Messages */}
            {Array.from(new Set(messages.filter(m => m.group).map(m => m.group!))).sort().map(groupName => {
              const groupMessages = messages.filter(m => m.group === groupName);
              const isExpanded = expandedGroups[groupName] !== false; // Default to true

              return (
                <div key={groupName} className="border rounded-md overflow-hidden">
                  <div
                    className="flex items-center gap-2 p-2 bg-muted/50 cursor-pointer hover:bg-muted/80 transition-colors"
                    onClick={() => toggleGroup(groupName)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Folder className="w-4 h-4 text-blue-500" />
                    )}
                    <span className="text-xs font-medium flex-1">{groupName}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                      {groupMessages.length}
                    </Badge>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={groupMessages.every(m => m.selected)}
                        onCheckedChange={(checked) => {
                          setMessages(prev => prev.map(m =>
                            m.group === groupName ? { ...m, selected: !!checked } : m
                          ));
                        }}
                        className="h-4 w-4"
                      />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="p-2 space-y-1 bg-muted/10">
                      {groupMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`p-2 rounded border space-y-1.5 ${msg.selected ? "bg-primary/10 border-primary" : "bg-background"
                            }`}
                        >
                          {/* 第一行：序号、名称、分组、删除按钮 */}
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={msg.selected}
                              onCheckedChange={() => toggleSelect(msg.id)}
                              disabled={isSending}
                            />
                            <Badge
                              variant="outline"
                              className="text-xs h-5 w-6 flex-shrink-0"
                            >
                              {messages.indexOf(msg) + 1}
                            </Badge>
                            <Input
                              value={msg.name || ""}
                              onChange={(e) =>
                                handleEditMessage(msg.id, "name", e.target.value)
                              }
                              disabled={isSending}
                              placeholder="Message name..."
                              className="h-6 text-xs flex-1 min-w-[80px]"
                            />
                            <DebouncedInput
                              value={msg.group || ""}
                              onChange={(val) =>
                                handleEditMessage(msg.id, "group", val.toString())
                              }
                              disabled={isSending}
                              placeholder="Group..."
                              className="h-6 text-xs w-20 text-muted-foreground"
                            />
                            <Button
                              onClick={() => handleRemoveMessage(msg.id)}
                              disabled={isSending}
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 hover:bg-destructive/20 flex-shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>

                          {/* 第二行：ID、类型、数据 */}
                          <div className="flex items-center gap-2 pl-8">
                            <Input
                              value={msg.canId}
                              onChange={(e) =>
                                handleEditMessage(
                                  msg.id,
                                  "canId",
                                  e.target.value.toUpperCase()
                                )
                              }
                              disabled={isSending}
                              maxLength={msg.isExtended ? 8 : 3}
                              placeholder="ID"
                              className="font-mono h-6 text-xs w-20"
                            />
                            <Button
                              onClick={() => toggleExtended(msg.id)}
                              disabled={isSending}
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2"
                            >
                              {msg.isExtended ? "EXT" : "STD"}
                            </Button>
                            <Input
                              value={msg.data}
                              onChange={(e) =>
                                handleEditMessage(
                                  msg.id,
                                  "data",
                                  e.target.value.toUpperCase()
                                )
                              }
                              disabled={isSending}
                              placeholder="Data (hex)"
                              className="font-mono h-6 text-xs flex-1"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add Message 按钮放在消息列表底部 */}
            <Button
              onClick={handleAddMessage}
              disabled={!isConnected || isSending}
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs border-dashed"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Message
            </Button>
          </div>
        </div>

        {/* 发送控制 */}
        <div className="space-y-2 p-2 rounded-md bg-muted/30 border">
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Mode</Label>
              <div className="grid grid-cols-4 gap-1">
                <Button
                  onClick={() => setSendMode("next")}
                  disabled={isSending}
                  variant={sendMode === "next" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-1"
                >
                  Next
                </Button>
                <Button
                  onClick={() => setSendMode("all")}
                  disabled={isSending}
                  variant={sendMode === "all" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-1"
                >
                  All
                </Button>
                <Button
                  onClick={() => setSendMode("loop")}
                  disabled={isSending}
                  variant={sendMode === "loop" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-1"
                >
                  Loop
                </Button>
                <Button
                  onClick={() => setSendMode("csv")}
                  disabled={isSending}
                  variant={sendMode === "csv" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-1"
                >
                  CSV
                </Button>
              </div>
            </div>

            {sendMode === "loop" && (
              <div className="space-y-1">
                <Label className="text-xs">Interval (ms)</Label>
                <Input
                  type="number"
                  min="10"
                  value={loopInterval}
                  onChange={(e) => setLoopInterval(e.target.value)}
                  disabled={isSending}
                  className="h-7 text-xs"
                />
              </div>
            )}

            {sendMode === "csv" && (
              <div className="space-y-2">
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs flex-1"
                  >
                    <FileUp className="w-3 h-3 mr-1" />
                    {csvFileName ? "Change CSV" : "Import CSV"}
                  </Button>
                </div>
                {csvFileName && (
                  <div className="text-xs text-muted-foreground flex justify-between items-center px-1">
                    <span className="truncate max-w-[120px]" title={csvFileName}>{csvFileName}</span>
                    <span>{csvTotal} msgs</span>
                  </div>
                )}
                {isSending && (
                  <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-300"
                      style={{ width: `${(csvCurrent / csvTotal) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {!isSending ? (
            <Button
              onClick={sendMode === "csv" ? handleSendCsv : handleSendSelected}
              disabled={!isConnected || (sendMode !== "csv" && selectedCount === 0) || (sendMode === "csv" && csvSequence.length === 0)}
              className="w-full h-7 text-xs bg-green-600 hover:bg-green-700"
            >
              <Send className="w-3 h-3 mr-1" />
              {sendMode === "next"
                ? `Send Next (${selectedCount} selected)`
                : sendMode === "all"
                  ? `Send All (${selectedCount})`
                  : sendMode === "loop"
                    ? `Start Loop (${selectedCount})`
                    : "Start Sequence"}
            </Button>
          ) : (
            <Button
              onClick={handleStopSending}
              className="w-full h-7 text-xs"
              variant="destructive"
            >
              <Square className="w-3 h-3 mr-1" />
              Stop
            </Button>
          )}
        </div>

        {!isConnected && (
          <div className="flex items-center gap-1 p-2 rounded-md bg-muted/30 border">
            <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full"></div>
            <p className="text-xs text-muted-foreground">
              Connect to send messages
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
