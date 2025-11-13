import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCANStore } from "@/store/canStore";
import { Send } from "lucide-react";

export function CANMessageSender() {
  const { isConnected } = useCANStore();
  const [canId, setCanId] = useState("");
  const [canData, setCanData] = useState("");
  const [isExtended, setIsExtended] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSend = async () => {
    setError(null);
    setSuccess(false);

    // Validate inputs
    if (!canId) {
      const errorMsg = "CAN ID is required";
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    const idNum = parseInt(canId, 16);
    if (isNaN(idNum)) {
      const errorMsg = "Invalid CAN ID (must be hexadecimal)";
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    if (!isExtended && idNum > 0x7ff) {
      const errorMsg = "Standard CAN ID must be <= 0x7FF";
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    if (isExtended && idNum > 0x1fffffff) {
      const errorMsg = "Extended CAN ID must be <= 0x1FFFFFFF";
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    // Validate data
    const dataClean = canData.replace(/\s/g, "");
    if (dataClean.length % 2 !== 0) {
      const errorMsg = "Data must have an even number of hex digits";
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    if (dataClean.length > 16) {
      const errorMsg = "Data must be <= 8 bytes (16 hex digits)";
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    if (!/^[0-9A-Fa-f]*$/.test(dataClean)) {
      const errorMsg = "Data must contain only hexadecimal digits";
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    setIsSending(true);
    try {
      await invoke("send_can_message", {
        id: canId,
        data: dataClean,
        isExtended,
      });
      setSuccess(true);
      toast.success(
        `Message sent: ID ${canId} (${isExtended ? "EXT" : "STD"})`
      );
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      const errorMsg = `Failed to send: ${err}`;
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isSending && isConnected) {
      handleSend();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send CAN Message</CardTitle>
        <CardDescription>
          Transmit CAN messages through the connected serial port
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4">
          <div className="flex-1 space-y-2">
            <Label htmlFor="can-id">CAN ID (Hex)</Label>
            <Input
              id="can-id"
              placeholder={isExtended ? "00000000" : "000"}
              value={canId}
              onChange={(e) => setCanId(e.target.value.toUpperCase())}
              onKeyPress={handleKeyPress}
              disabled={!isConnected}
              maxLength={isExtended ? 8 : 3}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isExtended}
                onChange={(e) => {
                  setIsExtended(e.target.checked);
                  setCanId("");
                }}
                disabled={!isConnected}
                className="w-4 h-4"
              />
              <span className="text-sm">Extended (29-bit)</span>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="can-data">Data (Hex, max 8 bytes)</Label>
          <Input
            id="can-data"
            placeholder="00 11 22 33 44 55 66 77"
            value={canData}
            onChange={(e) => setCanData(e.target.value.toUpperCase())}
            onKeyPress={handleKeyPress}
            disabled={!isConnected}
          />
          <p className="text-xs text-muted-foreground">
            Enter hex bytes separated by spaces (e.g., "01 02 03")
          </p>
        </div>

        <Button
          onClick={handleSend}
          disabled={!isConnected || isSending}
          className="w-full"
        >
          <Send className="w-4 h-4 mr-2" />
          {isSending ? "Sending..." : "Send Message"}
        </Button>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </div>
        )}

        {success && (
          <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/50 p-3 rounded-md border border-green-200 dark:border-green-900">
            Message sent successfully!
          </div>
        )}

        {!isConnected && (
          <div className="text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 p-3 rounded-md border border-gray-200 dark:border-gray-700">
            Connect to a serial port to send messages
          </div>
        )}
      </CardContent>
    </Card>
  );
}
