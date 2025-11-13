import { Toaster } from "sonner";
import { SerialPortSelector } from "./components/SerialPortSelector";
import { CANMessageSender } from "./components/CANMessageSender";
import { CANMessageLog } from "./components/CANMessageLog";
import { CANMessageFilter } from "./components/CANMessageFilter";
import { ThemeToggle } from "./components/ThemeToggle";

function App() {
  return (
    <div className="min-h-screen bg-background transition-colors">
      <Toaster position="top-right" richColors />
      <div className="relative">
        <ThemeToggle />
        <div className="flex flex-col h-screen">
          {/* Header */}
          <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-6 py-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                    <div className="w-3 h-3 bg-primary rounded-full animate-pulse"></div>
                    CAN Monitor
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    Cross-platform CAN signal monitoring and transmission tool
                  </p>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 overflow-hidden">
            <div className="max-w-7xl mx-auto h-full p-6">
              <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-6 overflow-y-auto">
                  <SerialPortSelector />
                  <CANMessageSender />
                  <CANMessageFilter />
                </div>
                <div className="lg:col-span-2">
                  <CANMessageLog />
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
