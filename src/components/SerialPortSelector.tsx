import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCANStore } from "@/store/canStore";
import { useProjectStore } from "@/store/projectStore";
import { RefreshCw, Plug, Unplug, ChevronDown } from "lucide-react";

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

  const { currentProject, updateProject } = useProjectStore();

  const [canBaudRate, setCanBaudRate] = useState(() => {
    return currentProject?.canBaudRate 
      ? (parseInt(currentProject.canBaudRate) / 1000).toString() 
      : "500";
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBaudRateOpen, setIsBaudRateOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const baudRateInputRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => {
    if (isConnected) return;
    
    if (!isBaudRateOpen && baudRateInputRef.current) {
      const rect = baudRateInputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    setIsBaudRateOpen(!isBaudRateOpen);
  };

  // 从项目加载串口设置
  useEffect(() => {
    if (currentProject) {
      if (currentProject.canBaudRate) {
        setCanBaudRate((parseInt(currentProject.canBaudRate) / 1000).toString());
      }
      if (currentProject.selectedPort) {
        setSelectedPort(currentProject.selectedPort);
      }
    }
  }, [currentProject?.id]);

  // 保存串口设置到项目（10秒防抖）
  useEffect(() => {
    if (currentProject && currentProject.projectPath) {
      const saveTimer = setTimeout(() => {
        console.log("[SerialPortSelector] Auto-saving settings to project...");

        const updatedProject = {
          ...currentProject,
          selectedPort,
          canBaudRate: (parseInt(canBaudRate) * 1000).toString(),
          updatedAt: Date.now(),
        };

        // 先更新 store
        updateProject({
          selectedPort,
          canBaudRate: (parseInt(canBaudRate) * 1000).toString(),
        });

        // 再保存到文件
        invoke("save_project_to_file", {
          projectJson: JSON.stringify(updatedProject, null, 2),
          filePath: currentProject.projectPath,
        })
          .then(() => {
            console.log("[SerialPortSelector] ✓ Settings saved to project");
          })
          .catch((err) => {
            console.error(
              "[SerialPortSelector] ✗ Failed to save project:",
              err
            );
          });
      }, 10000); // 10秒防抖

      return () => clearTimeout(saveTimer);
    }
  }, [selectedPort, canBaudRate, currentProject?.id, currentProject?.projectPath]);

  // 常用CAN波特率选项
  const commonCanBaudRates = [
    "125",
    "250",
    "500",
    "800",
    "1000",
  ];

  const refreshPorts = async () => {
    setIsRefreshing(true);
    setConnectionError(null);
    try {
      const ports = await invoke<SerialPort[]>("list_serial_ports");
      setAvailablePorts(ports);
      // toast.success(
      //   `Found ${ports.length} serial port${ports.length !== 1 ? "s" : ""}`
      // );
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
        baudRate: 2000000,
        canBaudRate: parseInt(canBaudRate) * 1000,
      });
      setIsConnected(true);
      toast.success(`Connected to ${selectedPort} (CAN: ${canBaudRate} Kbps)`);
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
    <div className="space-y-3">
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
            CAN Baud Rate (Kbps)
          </Label>
          <div className="relative" ref={baudRateInputRef}>
            <Input
              id="baud-rate"
              type="text"
              value={canBaudRate}
              onChange={(e) => setCanBaudRate(e.target.value)}
              disabled={isConnected}
              placeholder="500"
              className="h-9 pr-8"
              onClick={toggleDropdown}
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-9 w-9 px-0 py-0 hover:bg-transparent"
              disabled={isConnected}
              onClick={toggleDropdown}
            >
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
            
            {isBaudRateOpen && !isConnected && createPortal(
              <>
                <div 
                  className="fixed inset-0 z-50 bg-transparent" 
                  onClick={() => setIsBaudRateOpen(false)} 
                />
                <div 
                  className="absolute z-50 rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
                  style={{
                    top: dropdownPosition.top + 4, // Add a little gap
                    left: dropdownPosition.left,
                    width: dropdownPosition.width,
                  }}
                >
                  <div className="p-1">
                    {commonCanBaudRates.map((rate) => (
                      <div
                        key={rate}
                        className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-2 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          setCanBaudRate(rate);
                          setIsBaudRateOpen(false);
                        }}
                      >
                        {rate}
                      </div>
                    ))}
                  </div>
                </div>
              </>,
              document.body
            )}
          </div>
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
              CAN: {canBaudRate} Kbps
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
