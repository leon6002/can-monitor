import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CANMessageTemplate {
  id: string;
  canId: string;
  data: string;
  isExtended: boolean;
  selected: boolean;
  name?: string; // 消息名称/备注
}

export interface ProjectConfig {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;

  // Serial Port Settings
  selectedPort: string | null;
  baudRate: string;

  // CAN Message Templates
  messageTemplates: CANMessageTemplate[];

  // Filter Settings
  filterMode: "none" | "whitelist" | "blacklist" | "block";
  filterRules: Array<{
    id: string;
    mask: string;
    enabled: boolean;
  }>;

  // Other Settings
  maxMessages: number;

  // Project Path
  projectPath: string | null;
}

interface ProjectStore {
  // Current Project
  currentProject: ProjectConfig | null;

  // Recent Projects
  recentProjects: Array<{
    id: string;
    name: string;
    path: string;
    lastOpened: number;
  }>;

  // Actions
  createProject: (name: string, projectPath: string) => ProjectConfig;
  loadProject: (project: ProjectConfig) => void;
  updateProject: (updates: Partial<ProjectConfig>) => void;
  saveProject: () => void;
  closeProject: () => void;
  addRecentProject: (id: string, name: string, path: string) => void;
  removeRecentProject: (id: string) => void;
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      currentProject: null,
      recentProjects: [],

      createProject: (name: string, projectPath: string) => {
        const newProject: ProjectConfig = {
          id: crypto.randomUUID(),
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          selectedPort: null,
          baudRate: "2000000",
          messageTemplates: [
            {
              id: crypto.randomUUID(),
              canId: "000",
              data: "00",
              isExtended: false,
              selected: true,
            },
          ],
          filterMode: "none",
          filterRules: [],
          maxMessages: 50,
          projectPath,
        };

        set({ currentProject: newProject });
        get().addRecentProject(newProject.id, name, projectPath);
        return newProject;
      },

      loadProject: (project: ProjectConfig) => {
        set({ currentProject: { ...project, updatedAt: Date.now() } });
        get().addRecentProject(
          project.id,
          project.name,
          project.projectPath || ""
        );
      },

      updateProject: (updates: Partial<ProjectConfig>) => {
        const current = get().currentProject;
        if (!current) return;

        set({
          currentProject: {
            ...current,
            ...updates,
            updatedAt: Date.now(),
          },
        });
      },

      saveProject: () => {
        const current = get().currentProject;
        if (!current) return;

        // This will trigger the save through Tauri command
        set({
          currentProject: {
            ...current,
            updatedAt: Date.now(),
          },
        });
      },

      closeProject: () => {
        set({ currentProject: null });
      },

      addRecentProject: (id: string, name: string, path: string) => {
        set((state) => {
          const filtered = state.recentProjects.filter((p) => p.id !== id);
          return {
            recentProjects: [
              { id, name, path, lastOpened: Date.now() },
              ...filtered,
            ].slice(0, 10), // Keep only 10 most recent
          };
        });
      },

      removeRecentProject: (id: string) => {
        set((state) => ({
          recentProjects: state.recentProjects.filter((p) => p.id !== id),
        }));
      },
    }),
    {
      name: "can-monitor-projects",
      partialize: (state) => ({
        recentProjects: state.recentProjects,
      }),
    }
  )
);
