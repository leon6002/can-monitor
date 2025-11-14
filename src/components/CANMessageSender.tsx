import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCANStore } from "@/store/canStore";
import {
  Send,
  Radio,
  Cpu,
  Plus,
  Trash2,
  Play,
  Square,
  Repeat,
} from "lucide-react";

interface CANMessageItem {
  id: string;
  canId: string;
  canData: string;
  isExtended: boolean;
}

export function CANMessageSender() {
  const { isConnected } = useCANStore();

  // 单条发送状态
  const [canId, setCanId] = useState("");
  const [canData, setCanData] = useState("");
  const [isExtended, setIsExtended] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // 消息列表
  const [messageList, setMessageList] = useState<CANMessageItem[]>([]);

  // 循环发送状态
  const [isLooping, setIsLooping] = useState(false);
  const [loopMode, setLoopMode] = useState<"single" | "multiple">("single");
  const [loopInterval, setLoopInterval] = useState("100");
  const [loopCount, setLoopCount] = useState(0);

  const loopTimerRef = useRef<number | null>(null);
  const currentIndexRef = useRef(0);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (loopTimerRef.current) {
        clearInterval(loopTimerRef.current);
      }
    };
  }, []);

  // 验证消息
  const validateMessage = (
    id: string,
    data: string,
    extended: boolean
  ): string | null => {
    if (!id) {
      return "CAN ID is required";
    }

    const idNum = parseInt(id, 16);
    if (isNaN(idNum)) {
      return "Invalid CAN ID (must be hexadecimal)";
    }

    if (!extended && idNum > 0x7ff) {
      return "Standard CAN ID must be <= 0x7FF";
    }

    if (extended && idNum > 0x1fffffff) {
      return "Extended CAN ID must be <= 0x1FFFFFFF";
    }

    // 移除所有空白字符（包括空格、制表符、换行等）
    const dataClean = data.replace(
      /[\s\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g,
      ""
    );

    // 如果有数据，检查是否只包含十六进制字符
    if (dataClean.length > 0) {
      // 查找第一个非十六进制字符
      const invalidCharMatch = dataClean.match(/[^0-9A-Fa-f]/);
      if (invalidCharMatch) {
        const invalidChar = invalidCharMatch[0];
        const position = invalidCharMatch.index! + 1;
        return `Invalid character '${invalidChar}' at position ${position}. Only 0-9, A-F allowed.`;
      }
    }

    if (dataClean.length % 2 !== 0) {
      return "Data must have an even number of hex digits";
    }

    if (dataClean.length > 16) {
      return "Data must be <= 8 bytes (16 hex digits)";
    }

    return null;
  };

  // 发送单条消息
  const sendMessage = async (id: string, data: string, extended: boolean) => {
    // 移除所有空白字符
    const dataClean = data.replace(
      /[\s\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g,
      ""
    );
    await invoke("send_can_message", {
      id,
      data: dataClean,
      isExtended: extended,
    });
  };

  // 单次发送
  const handleSend = async () => {
    const error = validateMessage(canId, canData, isExtended);
    if (error) {
      toast.error(error);
      return;
    }

    setIsSending(true);
    try {
      await sendMessage(canId, canData, isExtended);
      toast.success(
        `Message sent: ID ${canId} (${isExtended ? "EXT" : "STD"})`
      );
    } catch (err) {
      toast.error(`Failed to send: ${err}`);
    } finally {
      setIsSending(false);
    }
  };

  // 添加到消息列表
  const handleAddToList = () => {
    // 使用默认值：ID=200, Data=00
    const defaultId = "200";
    const defaultData = "00";

    const finalId = canId.trim() || defaultId;
    const finalData = canData.trim() || defaultData;

    const error = validateMessage(finalId, finalData, isExtended);
    if (error) {
      toast.error(error);
      return;
    }

    const newMessage: CANMessageItem = {
      id: crypto.randomUUID(),
      canId: finalId,
      canData: finalData,
      isExtended,
    };

    setMessageList((prev) => [...prev, newMessage]);
    toast.success(`Message added: ${finalId} → ${finalData}`);

    // 清空输入
    setCanId("");
    setCanData("");
  };

  // 从列表删除
  const handleRemoveFromList = (id: string) => {
    setMessageList((prev) => prev.filter((msg) => msg.id !== id));
    toast.success("Message removed");
  };

  // 编辑列表中的消息
  const handleEditMessage = (
    id: string,
    field: "canId" | "canData",
    value: string
  ) => {
    setMessageList((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, [field]: value } : msg))
    );
  };

  // 切换扩展帧
  const handleToggleExtended = (id: string) => {
    setMessageList((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, isExtended: !msg.isExtended } : msg
      )
    );
  };

  // 开始循环发送
  const handleStartLoop = () => {
    const interval = parseInt(loopInterval);
    if (isNaN(interval) || interval < 10) {
      toast.error("Interval must be >= 10ms");
      return;
    }

    if (loopMode === "single") {
      const error = validateMessage(canId, canData, isExtended);
      if (error) {
        toast.error(error);
        return;
      }
    } else {
      if (messageList.length === 0) {
        toast.error("Message list is empty");
        return;
      }
    }

    setIsLooping(true);
    setLoopCount(0);
    currentIndexRef.current = 0;

    loopTimerRef.current = window.setInterval(async () => {
      try {
        if (loopMode === "single") {
          await sendMessage(canId, canData, isExtended);
        } else {
          const msg = messageList[currentIndexRef.current];
          await sendMessage(msg.canId, msg.canData, msg.isExtended);
          currentIndexRef.current =
            (currentIndexRef.current + 1) % messageList.length;
        }
        setLoopCount((prev) => prev + 1);
      } catch (err) {
        console.error("Loop send error:", err);
      }
    }, interval);

    toast.success("Loop started");
  };

  // 停止循环发送
  const handleStopLoop = () => {
    if (loopTimerRef.current) {
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    setIsLooping(false);
    toast.success(`Loop stopped (sent ${loopCount} messages)`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isSending && !isLooping && isConnected) {
      handleSend();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4" />
            <CardTitle className="text-sm">Send Message</CardTitle>
            {isConnected && (
              <Badge variant="default" className="text-xs h-5">
                <Cpu className="w-2 h-2 mr-1" />
                Ready
              </Badge>
            )}
            {isLooping && (
              <Badge variant="default" className="text-xs h-5 bg-green-600">
                <Repeat className="w-2 h-2 mr-1 animate-spin" />
                Looping
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* CAN ID and Extended Toggle Row */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="can-id" className="text-xs font-medium">
                ID
              </Label>
              <Input
                id="can-id"
                placeholder={isExtended ? "00000000" : "000"}
                value={canId}
                onChange={(e) => setCanId(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                disabled={!isConnected || isLooping}
                maxLength={isExtended ? 8 : 3}
                className="font-mono h-8 text-xs"
              />
            </div>
            <div className="flex items-end">
              <Badge
                variant={isExtended ? "default" : "secondary"}
                className="text-xs h-6"
              >
                {isExtended ? "29-bit" : "11-bit"}
              </Badge>
            </div>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/30">
            <Label htmlFor="extended-toggle" className="text-xs">
              Extended Frame
            </Label>
            <Switch
              id="extended-toggle"
              checked={isExtended}
              onCheckedChange={(checked) => {
                setIsExtended(checked);
                setCanId("");
              }}
              disabled={!isConnected || isLooping}
            />
          </div>
        </div>

        {/* Data Input */}
        <div className="space-y-1">
          <Label htmlFor="can-data" className="text-xs font-medium">
            Data
          </Label>
          <Input
            id="can-data"
            placeholder="00 11 22 33 44 55 66 77"
            value={canData}
            onChange={(e) => setCanData(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            disabled={!isConnected || isLooping}
            className="font-mono h-8 text-xs"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Max 8 bytes</span>
            <span>{canData.replace(/\s/g, "").length / 2}/8</span>
          </div>
        </div>

        {/* Send Button */}
        <Button
          onClick={handleSend}
          disabled={!isConnected || isSending || isLooping}
          className="w-full h-7 text-xs"
        >
          <Send
            className={`w-3 h-3 mr-1 ${isSending ? "animate-pulse" : ""}`}
          />
          Send Once
        </Button>

        {/* Loop Control */}
        <div className="space-y-2 p-3 rounded-md bg-muted/30 border">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Loop Send</Label>
            {isLooping && (
              <Badge variant="default" className="text-xs bg-green-600">
                {loopCount} sent
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Mode</Label>
              <Select
                value={loopMode}
                onValueChange={(value: "single" | "multiple") =>
                  setLoopMode(value)
                }
                disabled={isLooping}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="multiple">Multiple</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Interval (ms)</Label>
              <Input
                type="number"
                min="10"
                value={loopInterval}
                onChange={(e) => setLoopInterval(e.target.value)}
                disabled={isLooping}
                className="h-7 text-xs"
              />
            </div>
          </div>

          <div className="flex gap-2">
            {!isLooping ? (
              <Button
                onClick={handleStartLoop}
                disabled={!isConnected}
                className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700"
              >
                <Play className="w-3 h-3 mr-1" />
                Start Loop
              </Button>
            ) : (
              <Button
                onClick={handleStopLoop}
                className="flex-1 h-7 text-xs"
                variant="destructive"
              >
                <Square className="w-3 h-3 mr-1" />
                Stop Loop
              </Button>
            )}
          </div>
        </div>

        {/* Message List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">
              Message List ({messageList.length})
            </Label>
            <div className="flex items-center gap-1">
              <Button
                onClick={handleAddToList}
                disabled={!isConnected || isLooping}
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
              {messageList.length > 0 && (
                <Button
                  onClick={() => {
                    setMessageList([]);
                    toast.success("List cleared");
                  }}
                  disabled={isLooping}
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2"
                >
                  Clear All
                </Button>
              )}
            </div>
          </div>

          {messageList.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-4 rounded-md border border-dashed bg-muted/20">
              <Send className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                No messages in list. Click + to add.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-2 bg-background">
              {messageList.map((msg, index) => (
                <div
                  key={msg.id}
                  className="space-y-2 p-2 rounded-md bg-muted/30 border"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs h-5 w-6">
                      {index + 1}
                    </Badge>
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        value={msg.canId}
                        onChange={(e) =>
                          handleEditMessage(
                            msg.id,
                            "canId",
                            e.target.value.toUpperCase()
                          )
                        }
                        disabled={isLooping}
                        placeholder="ID"
                        maxLength={msg.isExtended ? 8 : 3}
                        className="font-mono h-6 text-xs flex-1"
                      />
                      <Button
                        onClick={() => handleToggleExtended(msg.id)}
                        disabled={isLooping}
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs px-2"
                      >
                        {msg.isExtended ? "EXT" : "STD"}
                      </Button>
                    </div>
                    <Button
                      onClick={() => handleRemoveFromList(msg.id)}
                      disabled={isLooping}
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-destructive/20"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  <Input
                    value={msg.canData}
                    onChange={(e) =>
                      handleEditMessage(
                        msg.id,
                        "canData",
                        e.target.value.toUpperCase()
                      )
                    }
                    disabled={isLooping}
                    placeholder="Data (e.g., 11 22 33)"
                    className="font-mono h-6 text-xs"
                  />
                </div>
              ))}
            </div>
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
