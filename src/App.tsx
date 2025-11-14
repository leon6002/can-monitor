import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { SerialPortSelector } from "./components/SerialPortSelector";
import { CANMessageSender } from "./components/CANMessageSender";
import { CANMessageLog } from "./components/CANMessageLog";
import { ThemeToggle } from "./components/ThemeToggle";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import { Badge } from "./components/ui/badge";
import { useCANStore } from "./store/canStore";
import { Activity } from "lucide-react";

function App() {
  const isConnected = useCANStore((state) => state.isConnected);
  const [accordionValue, setAccordionValue] = useState<string[]>([
    "serial-port",
  ]);

  // 连接成功后自动折叠 Serial Port accordion
  useEffect(() => {
    if (isConnected) {
      setAccordionValue([]);
    }
  }, [isConnected]);
  return (
    <div className="h-screen bg-background transition-colors relative">
      <Toaster position="top-right" richColors />

      {/* Theme Toggle - Fixed Position */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      {/* Main Content */}
      <main className="h-full overflow-hidden">
        <div className="container mx-auto h-full px-4 py-4 max-w-[1800px]">
          <div className="h-full grid grid-cols-1 lg:grid-cols-[500px_1fr] gap-4">
            {/* Left Sidebar */}
            <div className="h-full flex flex-col gap-4 overflow-y-auto">
              <Accordion
                type="multiple"
                value={accordionValue}
                onValueChange={setAccordionValue}
                className="flex-none"
              >
                <AccordionItem
                  value="serial-port"
                  className="border rounded-lg px-4 bg-card"
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-primary rounded-full"></div>
                      <span className="font-semibold">Serial Port</span>
                      {isConnected && (
                        <Badge
                          variant="success"
                          className="text-xs h-5 animate-pulse ml-auto"
                        >
                          <Activity className="w-2 h-2 mr-1" />
                          Connected
                        </Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <SerialPortSelector />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="flex-1 min-h-0">
                <CANMessageSender />
              </div>
            </div>

            {/* Right Content - Message Log */}
            <div className="h-full overflow-hidden">
              <CANMessageLog />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
