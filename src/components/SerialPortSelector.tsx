import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCANStore } from "@/store/canStore";
import { RefreshCw, Plug, Unplug, Usb, Activity } from "lucide-react";

interface SerialPort {
  name: string;
  path: string;
}

export function SerialPortSelector() {
  const {
    availablePorts,
    selectedPort,
    isConnected,
    connectionError,
    setAvailablePorts,
    setSelectedPort,
    setIsConnected,
    setConnectionError,
  } = useCANStore();

  const [baudRate, setBaudRate] = useState("2000000");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // 常用波特率选项
  const commonBaudRates = [
    "9600",
    "19200",
    "38400",
    "57600",
    "115200",
    "230400",
    "460800",
    "921600",
    "1000000",
    "2000000",
  ];

  const refreshPorts = async () => {
    setIsRefreshing(true);
    setConnectionError(null);
    try {
      const ports = await invoke<SerialPort[]>("list_serial_ports");
      setAvailablePorts(ports);
      toast.success(
        `Found ${ports.length} serial port${ports.length !== 1 ? "s" : ""}`
      );
    } catch (error) {
      const errorMsg = `Failed to list ports: ${error}`;
      setConnectionError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedPort) {
      const errorMsg = "Please select a port";
      setConnectionError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);
    try {
      await invoke("connect_serial_port", {
        portName: selectedPort,
        baudRate: parseInt(baudRate),
      });
      setIsConnected(true);
      toast.success(`Connected to ${selectedPort} at ${baudRate} baud`);
    } catch (error) {
      const errorMsg = `Failed to connect: ${error}`;
      setConnectionError(errorMsg);
      setIsConnected(false);
      toast.error(errorMsg);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke("disconnect_serial_port");
      setIsConnected(false);
      setConnectionError(null);
      toast.success("Disconnected from serial port");
    } catch (error) {
      const errorMsg = `Failed to disconnect: ${error}`;
      setConnectionError(errorMsg);
      toast.error(errorMsg);
    }
  };

  useEffect(() => {
    refreshPorts();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Usb className="w-4 h-4" />
            <CardTitle className="text-sm">Serial Port</CardTitle>
            {isConnected && (
              <Badge variant="success" className="text-xs h-5 animate-pulse">
                <Activity className="w-2 h-2 mr-1" />
                Connected
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="port-select" className="text-xs font-medium">
              Port
            </Label>
            <Select
              value={selectedPort || ""}
              onValueChange={setSelectedPort}
              disabled={isConnected}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select port..." />
              </SelectTrigger>
              <SelectContent>
                {availablePorts.map((port: SerialPort) => (
                  <SelectItem key={port.path} value={port.path}>
                    {port.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="baud-rate" className="text-xs font-medium">
              Baud Rate
            </Label>
            <Select
              value={baudRate}
              onValueChange={setBaudRate}
              disabled={isConnected}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select baud rate..." />
              </SelectTrigger>
              <SelectContent>
                {commonBaudRates.map((rate) => (
                  <SelectItem key={rate} value={rate}>
                    {rate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-1">
          <Button
            onClick={refreshPorts}
            disabled={isConnected || isRefreshing}
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
          >
            <RefreshCw
              className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
          {!isConnected ? (
            <Button
              onClick={handleConnect}
              disabled={!selectedPort || isConnecting}
              className="flex-1 h-7 text-xs"
            >
              <Plug className="w-3 h-3 mr-1" />
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          ) : (
            <Button
              onClick={handleDisconnect}
              variant="destructive"
              className="flex-1 h-7 text-xs"
            >
              <Unplug className="w-3 h-3 mr-1" />
              Disconnect
            </Button>
          )}
        </div>

        {connectionError && (
          <div className="flex items-center gap-1 p-2 rounded-md bg-destructive/10 border border-destructive/20">
            <div className="w-1.5 h-1.5 bg-destructive rounded-full"></div>
            <p className="text-xs text-destructive">{connectionError}</p>
          </div>
        )}

        {isConnected && selectedPort && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 border">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
            <div className="flex-1">
              <p className="text-xs font-medium text-green-800 dark:text-green-200">
                {selectedPort.length > 25
                  ? selectedPort.substring(0, 25) + "..."
                  : selectedPort}
              </p>
              <p className="text-xs text-green-600 dark:text-green-400">
                {baudRate} baud
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
