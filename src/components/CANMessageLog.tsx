import { useEffect, useRef, useState } from "react";
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
import { useCANStore, CANMessage } from "@/store/canStore";
import { Trash2, Download, Settings } from "lucide-react";

export function CANMessageLog() {
  const {
    messages,
    addMessage,
    clearMessages,
    filterMode,
    filterRules,
    maxMessages,
    setMaxMessages,
  } = useCANStore();
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<CANMessage | null>(
    null
  );
  const [showSettings, setShowSettings] = useState(false);
  const [tempMaxMessages, setTempMaxMessages] = useState(
    maxMessages.toString()
  );

  useEffect(() => {
    const unlisten = listen<CANMessage>("can-message", (event) => {
      addMessage(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addMessage]);

  useEffect(() => {
    if (autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  const shouldDisplayMessage = (message: CANMessage): boolean => {
    if (filterMode === "none") return true;

    const messageId = parseInt(message.id, 16);
    const enabledRules = filterRules.filter((rule) => rule.enabled);

    if (enabledRules.length === 0) return true;

    for (const rule of enabledRules) {
      const maskId = parseInt(rule.mask, 16);
      if (isNaN(maskId)) continue;

      if (filterMode === "whitelist") {
        // Show only if ID matches any whitelist rule
        if (messageId === maskId) return true;
      } else if (filterMode === "blacklist") {
        // Hide if ID matches any blacklist rule
        if (messageId === maskId) return false;
      }
    }

    // Default behavior
    return filterMode === "blacklist";
  };

  const filteredMessages = messages.filter(shouldDisplayMessage);

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

  const exportMessages = () => {
    try {
      const csv = [
        "Timestamp,ID,Extended,Data",
        ...filteredMessages.map(
          (msg) => `${msg.timestamp},${msg.id},${msg.isExtended},${msg.data}`
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
          <div>
            <CardTitle>CAN Message Log</CardTitle>
            <CardDescription>
              {filteredMessages.length} message
              {filteredMessages.length !== 1 ? "s" : ""}
              {messages.length !== filteredMessages.length &&
                ` (${messages.length - filteredMessages.length} filtered)`}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="w-4 h-4"
              />
              Auto-scroll
            </label>
            <Button
              onClick={() => setShowSettings(!showSettings)}
              variant="outline"
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
              onClick={clearMessages}
              variant="outline"
              size="sm"
              disabled={messages.length === 0}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="mt-4 p-4 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label
                  htmlFor="max-messages"
                  className="text-gray-700 dark:text-gray-300"
                >
                  Max Messages to Display
                </Label>
                <input
                  id="max-messages"
                  type="number"
                  min="1"
                  value={tempMaxMessages}
                  onChange={(e) => setTempMaxMessages(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-gray-900 dark:text-gray-100"
                />
              </div>
              <Button onClick={handleApplyMaxMessages} size="sm">
                Apply
              </Button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              Current: {maxMessages} messages (Total received: {messages.length}
              )
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto border rounded-md bg-gray-50 dark:bg-gray-900/50">
          {filteredMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              No messages received yet
            </div>
          ) : (
            <div className="font-mono text-xs">
              <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 font-semibold p-2 grid grid-cols-12 gap-2 text-gray-900 dark:text-gray-100">
                <div className="col-span-3">Timestamp</div>
                <div className="col-span-2">ID</div>
                <div className="col-span-1">Type</div>
                <div className="col-span-1">DLC</div>
                <div className="col-span-5">Data</div>
              </div>
              {filteredMessages.map((message, index) => (
                <div
                  key={index}
                  className="p-2 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 grid grid-cols-12 gap-2 cursor-pointer text-gray-900 dark:text-gray-100"
                  onClick={() => setSelectedMessage(message)}
                >
                  <div className="col-span-3 text-gray-600 dark:text-gray-400">
                    {formatTimestamp(message.timestamp)}
                  </div>
                  <div className="col-span-2 font-semibold">{message.id}</div>
                  <div className="col-span-1">
                    {message.isExtended ? "EXT" : "STD"}
                  </div>
                  <div className="col-span-1">
                    {message.data.replace(/\s/g, "").length / 2}
                  </div>
                  <div className="col-span-5">{formatData(message.data)}</div>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      </CardContent>

      {/* Message Detail Modal */}
      {selectedMessage && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setSelectedMessage(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 border rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto shadow-xl text-gray-900 dark:text-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Message Details</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedMessage(null)}
              >
                ✕
              </Button>
            </div>

            <div className="space-y-4 font-mono text-sm">
              <div>
                <Label className="text-gray-600 dark:text-gray-400">
                  Timestamp
                </Label>
                <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded">
                  {formatTimestamp(selectedMessage.timestamp)}
                </div>
              </div>

              <div>
                <Label className="text-gray-600 dark:text-gray-400">
                  CAN ID
                </Label>
                <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded">
                  {selectedMessage.id}
                </div>
              </div>

              <div>
                <Label className="text-gray-600 dark:text-gray-400">
                  Frame Type
                </Label>
                <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded">
                  {selectedMessage.isExtended
                    ? "Extended (29-bit)"
                    : "Standard (11-bit)"}
                </div>
              </div>

              <div>
                <Label className="text-gray-600 dark:text-gray-400">
                  Data Length (DLC)
                </Label>
                <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded">
                  {selectedMessage.data.replace(/\s/g, "").length / 2} bytes
                </div>
              </div>

              <div>
                <Label className="text-gray-600 dark:text-gray-400">
                  Data (Formatted)
                </Label>
                <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded break-all">
                  {formatData(selectedMessage.data)}
                </div>
              </div>

              <div>
                <Label className="text-gray-600 dark:text-gray-400">
                  Raw Bytes (Hex)
                </Label>
                <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded break-all">
                  {selectedMessage.rawBytes || "N/A"}
                </div>
              </div>

              <div>
                <Label className="text-gray-600 dark:text-gray-400">
                  Raw Bytes (Decimal)
                </Label>
                <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded break-all text-xs">
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
      )}
    </Card>
  );
}
