import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Toaster } from "sonner";
import { SerialPortSelector } from "./components/SerialPortSelector";
import { CANMessageSender } from "./components/CANMessageSender";
import { CANMessageLog } from "./components/CANMessageLog";
import { ThemeToggle } from "./components/ThemeToggle";
import { ProjectManager } from "./components/ProjectManager";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import { TooltipProvider } from "./components/ui/tooltip";
import { Badge } from "./components/ui/badge";
import { useCANStore } from "./store/canStore";
import { useProjectStore, ProjectConfig } from "./store/projectStore";
import { Activity } from "lucide-react";

function App() {
  const isConnected = useCANStore((state) => state.isConnected);
  const { recentProjects, loadProject } = useProjectStore();
  const [accordionValue, setAccordionValue] = useState<string[]>([
    "serial-port",
  ]);

  // 自动加载最近使用的项目
  useEffect(() => {
    const autoLoadProject = async () => {
      if (recentProjects.length > 0) {
        const mostRecent = recentProjects[0];
        console.log("[App] Auto-loading most recent project:", mostRecent.name);

        try {
          // 检查项目文件是否存在
          const exists = await invoke<boolean>("check_project_exists", {
            filePath: mostRecent.path,
          });

          if (exists) {
            // 加载项目文件
            const projectJson = await invoke<string>("load_project_from_file", {
              filePath: mostRecent.path,
            });
            const project: ProjectConfig = JSON.parse(projectJson);
            loadProject(project);
            console.log("[App] ✓ Auto-loaded project:", project.name);
          } else {
            console.log("[App] ✗ Project file not found:", mostRecent.path);
          }
        } catch (error) {
          console.error("[App] ✗ Failed to auto-load project:", error);
        }
      }
    };

    autoLoadProject();
  }, []); // 只在应用启动时执行一次

  // 连接成功后自动折叠 Serial Port accordion
  useEffect(() => {
    if (isConnected) {
      setAccordionValue([]);
    }
  }, [isConnected]);
  return (
    <TooltipProvider>
      <div className="h-screen bg-background transition-colors flex flex-col">
        <Toaster position="top-right" richColors />

      {/* Header Menu Bar */}
      <header className="flex-none border-b border-border bg-card">
        <div className="flex items-center justify-between px-4 py-2">
          {/* Left: App Title */}
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">CAN Monitor</h1>
          </div>

          {/* Right: Project Manager and Theme Toggle */}
          <div className="flex items-center gap-2">
            <ProjectManager />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <div className="container mx-auto h-full px-4 py-3 max-w-[1800px]">
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
    </TooltipProvider>
  );
}

export default App;
