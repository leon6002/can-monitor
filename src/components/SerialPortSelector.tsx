import { useState, useEffect } from "react";
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
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Usb className="w-5 h-5" />
              Serial Port Connection
            </CardTitle>
            <CardDescription>
              Select and connect to a serial port for CAN communication
            </CardDescription>
          </div>
          {isConnected && (
            <Badge variant="success" className="animate-pulse">
              <Activity className="w-3 h-3 mr-1" />
              Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="port-select" className="text-sm font-medium">
              Serial Port
            </Label>
            <Select
              id="port-select"
              value={selectedPort || ""}
              onChange={(e) => setSelectedPort(e.target.value)}
              disabled={isConnected}
            >
              <option value="">Select a port...</option>
              {availablePorts.map((port) => (
                <option key={port.path} value={port.path}>
                  {port.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {availablePorts.length} port{availablePorts.length !== 1 ? "s" : ""} available
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="baud-rate" className="text-sm font-medium">
              Baud Rate
            </Label>
            <div className="relative">
              <Input
                id="baud-rate"
                type="text"
                list="baud-rate-options"
                value={baudRate}
                onChange={(e) => setBaudRate(e.target.value)}
                disabled={isConnected}
                placeholder="Enter baud rate"
              />
              <datalist id="baud-rate-options">
                {commonBaudRates.map((rate) => (
                  <option key={rate} value={rate} />
                ))}
              </datalist>
            </div>
            <p className="text-xs text-muted-foreground">
              Standard CAN baud rates available
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex gap-2">
          <Button
            onClick={refreshPorts}
            disabled={isConnected || isRefreshing}
            variant="outline"
            size="sm"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          {!isConnected ? (
            <Button
              onClick={handleConnect}
              disabled={!selectedPort || isConnecting}
              className="flex-1"
            >
              <Plug className="w-4 h-4 mr-2" />
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          ) : (
            <Button
              onClick={handleDisconnect}
              variant="destructive"
              className="flex-1"
            >
              <Unplug className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
          )}
        </div>

        {connectionError && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <div className="w-2 h-2 bg-destructive rounded-full"></div>
            <p className="text-sm text-destructive">{connectionError}</p>
          </div>
        )}

        {isConnected && selectedPort && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Connected to {selectedPort}
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
