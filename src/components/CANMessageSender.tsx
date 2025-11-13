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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useCANStore } from "@/store/canStore";
import { Send, Radio, Hash, Cpu } from "lucide-react";

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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Radio className="w-5 h-5" />
              Send CAN Message
            </CardTitle>
            <CardDescription>
              Transmit CAN messages through the connected serial port
            </CardDescription>
          </div>
          {isConnected && (
            <Badge variant="default">
              <Cpu className="w-3 h-3 mr-1" />
              Ready
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* CAN ID Input Section */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="can-id" className="text-sm font-medium flex items-center gap-2">
              <Hash className="w-4 h-4" />
              CAN ID (Hexadecimal)
            </Label>
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  id="can-id"
                  placeholder={isExtended ? "00000000" : "000"}
                  value={canId}
                  onChange={(e) => setCanId(e.target.value.toUpperCase())}
                  onKeyPress={handleKeyPress}
                  disabled={!isConnected}
                  maxLength={isExtended ? 8 : 3}
                  className="font-mono"
                />
              </div>
              <div className="flex items-center space-x-2 bg-muted px-3 py-2 rounded-md">
                <Badge variant={isExtended ? "default" : "secondary"} className="text-xs">
                  {isExtended ? "29-bit" : "11-bit"}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {isExtended ? "Extended CAN ID (0x00000000 - 0x1FFFFFFF)" : "Standard CAN ID (0x000 - 0x7FF)"}
            </p>
          </div>

          {/* Extended ID Toggle */}
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/30 border">
            <div className="space-y-1">
              <Label htmlFor="extended-toggle" className="text-sm font-medium">
                Extended Frame Format
              </Label>
              <p className="text-xs text-muted-foreground">
                Use 29-bit identifier instead of 11-bit
              </p>
            </div>
            <Switch
              id="extended-toggle"
              checked={isExtended}
              onCheckedChange={(checked) => {
                setIsExtended(checked);
                setCanId("");
              }}
              disabled={!isConnected}
            />
          </div>
        </div>

        <Separator />

        {/* Data Input Section */}
        <div className="space-y-2">
          <Label htmlFor="can-data" className="text-sm font-medium">
            CAN Data (Hexadecimal)
          </Label>
          <Input
            id="can-data"
            placeholder="00 11 22 33 44 55 66 77"
            value={canData}
            onChange={(e) => setCanData(e.target.value.toUpperCase())}
            onKeyPress={handleKeyPress}
            disabled={!isConnected}
            className="font-mono"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Enter hex bytes separated by spaces</span>
            <span>Max 8 bytes ({canData.replace(/\s/g, "").length / 2}/8)</span>
          </div>
        </div>

        {/* Send Button */}
        <Button
          onClick={handleSend}
          disabled={!isConnected || isSending}
          className="w-full h-11"
          size="lg"
        >
          <Send className={`w-4 h-4 mr-2 ${isSending ? "animate-pulse" : ""}`} />
          {isSending ? "Sending..." : "Send Message"}
        </Button>

        {/* Status Messages */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <div className="w-2 h-2 bg-destructive rounded-full"></div>
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Message sent successfully!
              </p>
              <p className="text-xs text-green-600 dark:text-green-400">
                ID: {canId} ({isExtended ? "EXT" : "STD"})
              </p>
            </div>
          </div>
        )}

        {!isConnected && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/30 border">
            <div className="w-2 h-2 bg-muted-foreground rounded-full"></div>
            <p className="text-sm text-muted-foreground">
              Connect to a serial port to send messages
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
