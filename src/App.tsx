import { Toaster } from "sonner";
import { SerialPortSelector } from "./components/SerialPortSelector";
import { CANMessageSender } from "./components/CANMessageSender";
import { CANMessageLog } from "./components/CANMessageLog";
import { CANMessageFilter } from "./components/CANMessageFilter";
import { ThemeToggle } from "./components/ThemeToggle";

function App() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 transition-colors">
      <Toaster position="top-right" richColors />
      <ThemeToggle />
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            CAN Monitor
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Cross-platform CAN signal monitoring and transmission tool
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <SerialPortSelector />
            <CANMessageSender />
            <CANMessageFilter />
          </div>

          <div className="lg:col-span-2">
            <CANMessageLog />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
