import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCANStore, CANMessage, FilterRule } from "@/store/canStore";
import {
  Trash2,
  Download,
  Settings,
  Activity,
  FileText,
  CheckCircle,
  AlertCircle,
  Filter,
  Plus,
  Shield,
  List,
  Ban,
  Pause,
  Play,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function CANMessageLog() {
  const {
    messages,
    sentMessages,
    addMessages,
    clearMessages,
    clearSentMessages,
    filterMode,
    filterRules,
    maxMessages,
    setMaxMessages,
    setFilterMode,
    addFilterRule,
    removeFilterRule,
    toggleFilterRule,
    updateFilterRule,
    shouldBlockMessage,
    toggleAllFilterRules,
  } = useCANStore();
  const [activeTab, setActiveTab] = useState<"received" | "sent">("received");
  const [selectedMessage, setSelectedMessage] = useState<CANMessage | null>(
    null
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [tempMaxMessages, setTempMaxMessages] = useState(
    maxMessages.toString()
  );
  const [newFilterId, setNewFilterId] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const newState = !prev;
      isPausedRef.current = newState;
      return newState;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        togglePause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePause]);

  // 使用 requestAnimationFrame 节流批量更新
  const messageBufferRef = useRef<CANMessage[]>([]);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const addMessagesRef = addMessages;
    const shouldBlockRef = shouldBlockMessage;

    const flushBuffer = () => {
      if (messageBufferRef.current.length > 0) {
        // 在 block 模式下，过滤掉被屏蔽的消息
        const messagesToAdd = messageBufferRef.current.filter(
          (msg) => !shouldBlockRef(msg.id)
        );

        if (messagesToAdd.length > 0) {
          addMessagesRef(messagesToAdd);
        }

        messageBufferRef.current = [];
      }
      rafIdRef.current = null;
    };

    const unlisten = listen<CANMessage>("can-message", (event) => {
      // 如果暂停，不添加到缓冲区
      if (isPausedRef.current) return;

      // 添加到缓冲区
      messageBufferRef.current.push(event.payload);

      // 如果还没有安排更新，使用 RAF 安排一次
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flushBuffer);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      // 清理时刷新剩余消息
      flushBuffer();
    };
  }, []); // 空依赖数组，只在组件挂载时创建一次监听器

  // 使用 useMemo 缓存过滤后的消息，避免每次渲染都重新计算
  const filteredMessages = useMemo(() => {
    const targetMessages = activeTab === "received" ? messages : sentMessages;

    // block 模式：消息已经在接收时被过滤，直接显示所有消息
    if (filterMode === "none" || filterMode === "block") {
      return [...targetMessages].reverse();
    }

    const enabledRules = filterRules.filter((rule: FilterRule) => rule.enabled);
    if (enabledRules.length === 0) {
      return [...targetMessages].reverse();
    }

    // 预处理规则 ID，避免在循环中重复解析
    const parsedRules = enabledRules
      .map((rule: FilterRule) => ({
        id: parseInt(rule.mask, 16),
        enabled: rule.enabled,
      }))
      .filter((rule: { id: number; enabled: boolean }) => !isNaN(rule.id));

    const filtered = targetMessages.filter((message: CANMessage) => {
      const messageId = parseInt(message.id, 16);
      if (isNaN(messageId)) return false;

      for (const rule of parsedRules) {
        if (filterMode === "whitelist") {
          if (messageId === rule.id) return true;
        } else if (filterMode === "blacklist") {
          if (messageId === rule.id) return false;
        }
      }

      return filterMode === "blacklist";
    });

    return filtered.reverse();
  }, [messages, sentMessages, activeTab, filterMode, filterRules]);

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return `${timeStr}.${ms}`;
  };

  const formatData = (data: string): string => {
    // Format data as space-separated bytes (确保每2个字符一组)
    const cleaned = data.replace(/\s/g, ""); // 移除所有空格
    return cleaned.match(/.{1,2}/g)?.join(" ") || cleaned;
  };

  const handleApplyMaxMessages = () => {
    const num = parseInt(tempMaxMessages);
    if (isNaN(num) || num < 1) {
      toast.error("Please enter a valid number (minimum 1)");
      return;
    }
    setMaxMessages(num);
    setShowSettings(false);
    toast.success(`Max messages set to ${num}`);
  };

  const handleAddFilter = () => {
    if (!newFilterId) {
      toast.error("Please enter a CAN ID");
      return;
    }

    const idNum = parseInt(newFilterId, 16);
    if (isNaN(idNum)) {
      toast.error("Invalid CAN ID (must be hexadecimal)");
      return;
    }

    addFilterRule({
      id: crypto.randomUUID(),
      mask: newFilterId.toUpperCase(),
      enabled: true,
    });
    toast.success(`Filter added: ${newFilterId.toUpperCase()}`);
    setNewFilterId("");
  };

  const handleFilterKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddFilter();
    }
  };

  const getFilterModeIcon = (mode: string) => {
    switch (mode) {
      case "whitelist":
        return <List className="w-4 h-4" />;
      case "blacklist":
        return <Ban className="w-4 h-4" />;
      case "block":
        return <Shield className="w-4 h-4" />;
      default:
        return <Filter className="w-4 h-4" />;
    }
  };

  const getFilterModeBadge = (mode: string) => {
    switch (mode) {
      case "whitelist":
        return (
          <Badge variant="default" className="text-xs bg-green-600">
            Whitelist
          </Badge>
        );
      case "blacklist":
        return (
          <Badge variant="destructive" className="text-xs">
            Blacklist
          </Badge>
        );
      case "block":
        return (
          <Badge variant="default" className="text-xs bg-orange-600">
            Block
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-xs">
            Disabled
          </Badge>
        );
    }
  };

  const exportMessages = () => {
    try {
      const csv = [
        "Timestamp,ID,Extended,Data",
        ...filteredMessages.map(
          (msg: CANMessage) =>
            `${msg.timestamp},${msg.id},${msg.isExtended},${msg.data}`
        ),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `can-log-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${filteredMessages.length} messages to CSV`);
    } catch (error) {
      toast.error(`Failed to export messages: ${error}`);
    }
  };

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                CAN Message Log
              </CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex bg-muted rounded-lg p-0.5">
                  <Button
                    variant={activeTab === "received" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => setActiveTab("received")}
                  >
                    Received
                  </Button>
                  <Button
                    variant={activeTab === "sent" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => setActiveTab("sent")}
                  >
                    Sent
                  </Button>
                </div>
                <CardDescription className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {filteredMessages.length} message
                    {filteredMessages.length !== 1 ? "s" : ""}
                  </Badge>
                  {activeTab === "received" && messages.length !== filteredMessages.length && (
                    <Badge variant="secondary" className="text-xs">
                      {messages.length - filteredMessages.length} filtered
                    </Badge>
                  )}
                </CardDescription>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Action buttons */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={togglePause}
                  variant={isPaused ? "destructive" : "outline"}
                  size="sm"
                  className={isPaused ? "animate-pulse" : ""}
                >
                  {isPaused ? (
                    <Play className="w-4 h-4 mr-2" />
                  ) : (
                    <Pause className="w-4 h-4 mr-2" />
                  )}
                  {isPaused ? "Resume" : "Pause"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Pause/Resume (Space)</p>
              </TooltipContent>
            </Tooltip>
            <Button
              onClick={() => {
                if (!showFilter && filterMode === "none") {
                  setFilterMode("block");
                }
                setShowFilter(!showFilter);
                setShowSettings(false);
              }}
              variant={showFilter ? "default" : "outline"}
              size="sm"
            >
              <Filter className="w-4 h-4 mr-2" />
              Filter
              {filterMode !== "none" && getFilterModeBadge(filterMode)}
            </Button>
            <Button
              onClick={() => {
                setShowSettings(!showSettings);
                setShowFilter(false);
              }}
              variant={showSettings ? "default" : "outline"}
              size="sm"
            >
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
            <Button
              onClick={exportMessages}
              variant="outline"
              size="sm"
              disabled={filteredMessages.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button
              onClick={activeTab === "received" ? clearMessages : clearSentMessages}
              variant="outline"
              size="sm"
              disabled={(activeTab === "received" ? messages : sentMessages).length === 0}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>

        {/* Filter Panel */}
        {showFilter && (
          <div className="mt-4 p-3 rounded-md bg-muted/30 border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Message Filter</Label>
                {getFilterModeBadge(filterMode)}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {getFilterModeIcon(filterMode)}
                {filterMode === "whitelist" ? (
                  <span>Whitelist: Show only listed</span>
                ) : filterMode === "blacklist" ? (
                  <span>Blacklist: Hide listed</span>
                ) : filterMode === "block" ? (
                  <span>Block: Don't store listed</span>
                ) : (
                  <span>Filter disabled</span>
                )}
              </div>
            </div>

            <div className="flex gap-3 items-end">
              <div className="w-48 space-y-1.5">
                <Label htmlFor="filter-mode" className="text-xs font-medium">
                  Filter Mode
                </Label>
                <Select
                  value={filterMode}
                  onValueChange={(
                    value: "none" | "whitelist" | "blacklist" | "block"
                  ) => setFilterMode(value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Show All</SelectItem>
                    <SelectItem value="whitelist">Whitelist</SelectItem>
                    <SelectItem value="blacklist">Blacklist</SelectItem>
                    <SelectItem value="block">Block (Don't Store)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {filterMode !== "none" && (
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs font-medium">Add CAN ID</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. 123"
                      value={newFilterId}
                      onChange={(e) =>
                        setNewFilterId(e.target.value.toUpperCase())
                      }
                      onKeyDown={handleFilterKeyDown}
                      className="font-mono h-8 text-xs max-w-[200px]"
                    />
                    <Button
                      onClick={handleAddFilter}
                      size="sm"
                      className="h-8 text-xs px-3"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {filterMode !== "none" && (
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Active Filters ({filterRules.filter((r) => r.enabled).length})
                  </Label>
                  {filterRules.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="master-switch" className="text-xs text-muted-foreground">
                        All
                      </Label>
                      <Switch
                        id="master-switch"
                        checked={filterRules.every((r) => r.enabled)}
                        onCheckedChange={(checked) => toggleAllFilterRules(checked)}
                        className="scale-75 data-[state=checked]:bg-primary"
                      />
                    </div>
                  )}
                </div>

                {filterRules.length === 0 ? (
                  <div className="flex items-center justify-center gap-1 p-4 rounded-md border border-dashed bg-muted/20">
                    <Filter className="w-3 h-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      No filters added yet
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-32 overflow-y-auto pr-1">
                    {filterRules.map((rule: FilterRule) => (
                      <div
                        key={rule.id}
                        className="flex items-center gap-2 p-1.5 rounded-md border bg-background hover:bg-accent/50 transition-colors group"
                      >
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={() => toggleFilterRule(rule.id)}
                          className="scale-75 data-[state=checked]:bg-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <Input
                            value={rule.mask}
                            onChange={(e) =>
                              updateFilterRule(
                                rule.id,
                                e.target.value.toUpperCase()
                              )
                            }
                            className="font-mono text-xs h-6 px-1 border-transparent bg-transparent hover:bg-muted focus:bg-background focus:border-input transition-colors w-full"
                            disabled={!rule.enabled}
                          />
                        </div>
                        <Button
                          onClick={() => removeFilterRule(rule.id)}
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="mt-4 p-4 rounded-md bg-muted/30 border space-y-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-medium">
                Message Display Settings
              </Label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="max-messages" className="text-sm">
                  Max Messages to Display
                </Label>
                <input
                  id="max-messages"
                  type="number"
                  min="1"
                  max="2000"
                  value={tempMaxMessages}
                  onChange={(e) => setTempMaxMessages(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  onClick={handleApplyMaxMessages}
                  size="sm"
                  className="w-full"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Apply Setting
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground bg-background p-3 rounded-md border">
              <span>Current limit: {maxMessages} messages</span>
              <span>Total {activeTab}: {(activeTab === "received" ? messages : sentMessages).length} messages</span>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-6">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-muted/10 rounded-md border-2 border-dashed border-muted/30">
            <FileText className="w-12 h-12 mb-3 text-muted-foreground/50" />
            <div className="text-center">
              <p className="font-medium">No {activeTab} messages yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                {activeTab === "received"
                  ? "Connect to a serial port to start monitoring CAN traffic"
                  : "Send messages using the panel on the left"}
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col bg-background rounded-md border overflow-hidden">
            {/* Table Header */}
            <div className="bg-card/90 backdrop-blur-sm border-b font-mono text-xs">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-muted-foreground">
                <div className="col-span-3 font-medium">Timestamp</div>
                <div className="col-span-2 font-medium">ID</div>
                <div className="col-span-1 font-medium">Type</div>
                <div className="col-span-1 font-medium">DLC</div>
                <div className="col-span-5 font-medium">Data</div>
              </div>
            </div>

            {/* Table Body */}
            <div className="flex-1 overflow-y-auto font-mono text-xs">
              {filteredMessages.map((message: CANMessage, index: number) => (
                <div
                  key={index}
                  className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors group"
                  onClick={() => setSelectedMessage(message)}
                >
                  <div className="col-span-3 text-muted-foreground font-mono">
                    {formatTimestamp(message.timestamp)}
                  </div>
                  <div className="col-span-2 font-semibold text-foreground group-hover:text-primary transition-colors">
                    {message.id}
                  </div>
                  <div className="col-span-1">
                    <Badge
                      variant={message.isExtended ? "default" : "secondary"}
                      className="text-[10px] h-5 px-1.5"
                    >
                      {message.isExtended ? "EXT" : "STD"}
                    </Badge>
                  </div>
                  <div className="col-span-1 text-muted-foreground">
                    {message.data.replace(/\s/g, "").length / 2}
                  </div>
                  <div className="col-span-5 text-foreground font-mono tracking-wide">
                    {formatData(message.data)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {/* Message Detail Modal */}
      {selectedMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4  backdrop-blur-sm"
          onClick={() => setSelectedMessage(null)}
        >
          <div
            className="bg-white dark:bg-black border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header - Fixed */}
            <div className="flex items-center justify-between p-6 border-b border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <h3 className="text-lg font-semibold">CAN Message Details</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedMessage(null)}
                className="h-8 w-8 p-0 hover:bg-destructive/20 hover:text-destructive"
              >
                ✕
              </Button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto max-h-[calc(85vh-80px)] bg-card">
              <div className="space-y-6">
                {/* Message Overview */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      CAN ID
                    </Label>
                    <div className="p-3 bg-muted/50 rounded-md border">
                      <p className="font-mono text-lg font-semibold text-primary">
                        {selectedMessage.id}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Frame Type</Label>
                    <div className="p-3 bg-muted/50 rounded-md border">
                      <Badge
                        variant={
                          selectedMessage.isExtended ? "default" : "secondary"
                        }
                        className="text-sm"
                      >
                        {selectedMessage.isExtended
                          ? "Extended (29-bit)"
                          : "Standard (11-bit)"}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="border-t my-4"></div>

                {/* Message Data */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Timestamp</Label>
                    <div className="p-3 bg-muted/50 rounded-md border font-mono text-sm">
                      {formatTimestamp(selectedMessage.timestamp)}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Data Length (DLC)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {selectedMessage.data.replace(/\s/g, "").length / 2}{" "}
                        bytes
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Data (Formatted)
                    </Label>
                    <div className="p-3 bg-muted/50 rounded-md border font-mono text-sm tracking-wide break-all">
                      {formatData(selectedMessage.data)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Raw Hex</Label>
                      <div className="p-3 bg-muted/50 rounded-md border font-mono text-xs break-all">
                        {selectedMessage.rawBytes || "N/A"}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Raw Decimal</Label>
                      <div className="p-3 bg-muted/50 rounded-md border font-mono text-xs break-all">
                        {(() => {
                          if (!selectedMessage.rawBytes) return "N/A";
                          try {
                            const bytes = selectedMessage.rawBytes
                              .split(" ")
                              .filter((byte) => byte.trim().length > 0)
                              .map((byte) => {
                                const num = parseInt(byte.trim(), 16);
                                return isNaN(num) ? null : num;
                              })
                              .filter((num) => num !== null);
                            return bytes.length > 0 ? bytes.join(", ") : "N/A";
                          } catch (e) {
                            return "Parse Error";
                          }
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
