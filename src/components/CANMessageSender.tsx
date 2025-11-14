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
import { Send, Plus, Trash2, Square, Radio } from "lucide-react";

interface CANMessageItem {
  id: string;
  canId: string;
  data: string;
  isExtended: boolean;
  selected: boolean;
}

export function CANMessageSender() {
  const isConnected = useCANStore((state) => state.isConnected);
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
  const [sendMode, setSendMode] = useState<"once" | "loop">("once");
  const [loopInterval, setLoopInterval] = useState("100");
  const [sentCount, setSentCount] = useState(0);

  const sendTimerRef = useRef<number | null>(null);
  const currentIndexRef = useRef(0);

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
    field: "canId" | "data",
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

    setIsSending(true);
    setSentCount(0);

    if (sendMode === "once") {
      // 单次发送所有选中的消息
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
      clearInterval(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    setIsSending(false);
    toast.success(`Stopped (sent ${sentCount} messages)`);
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
            {messages.map((msg, index) => (
              <div
                key={msg.id}
                className={`flex items-center gap-2 p-2 rounded border ${
                  msg.selected ? "bg-primary/10 border-primary" : "bg-muted/30"
                }`}
              >
                <Checkbox
                  checked={msg.selected}
                  onCheckedChange={() => toggleSelect(msg.id)}
                  disabled={isSending}
                />
                <Badge variant="outline" className="text-xs h-5 w-6">
                  {index + 1}
                </Badge>
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
                  className="font-mono h-6 text-xs flex-1"
                />
                <Button
                  onClick={() => handleRemoveMessage(msg.id)}
                  disabled={isSending}
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-destructive/20"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}

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
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Mode</Label>
              <div className="flex gap-1">
                <Button
                  onClick={() => setSendMode("once")}
                  disabled={isSending}
                  variant={sendMode === "once" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 h-7 text-xs"
                >
                  Once
                </Button>
                <Button
                  onClick={() => setSendMode("loop")}
                  disabled={isSending}
                  variant={sendMode === "loop" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 h-7 text-xs"
                >
                  Loop
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
          </div>

          {!isSending ? (
            <Button
              onClick={handleSendSelected}
              disabled={!isConnected || selectedCount === 0}
              className="w-full h-7 text-xs bg-green-600 hover:bg-green-700"
            >
              <Send className="w-3 h-3 mr-1" />
              Send Selected ({selectedCount})
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
