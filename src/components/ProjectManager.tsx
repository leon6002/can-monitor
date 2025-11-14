import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useProjectStore, ProjectConfig } from "@/store/projectStore";
import { FolderOpen, Plus, Trash2, Clock, Folder } from "lucide-react";

export function ProjectManager() {
  const {
    currentProject,
    recentProjects,
    createProject,
    loadProject,
    closeProject,
    removeRecentProject,
  } = useProjectStore();

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(
    null
  );

  const handleSelectDirectory = async () => {
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: "Select Project Directory",
      });

      if (result && typeof result === "string") {
        setSelectedDirectory(result);
        toast.success("Directory selected");
      }
    } catch (error) {
      toast.error(`Failed to select directory: ${error}`);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    if (!selectedDirectory) {
      toast.error("Please select a directory");
      return;
    }

    try {
      const projectPath = `${selectedDirectory}/${newProjectName}.canproject`;
      const project = createProject(newProjectName, projectPath);

      // Save project to file
      await invoke("save_project_to_file", {
        projectJson: JSON.stringify(project, null, 2),
        filePath: projectPath,
      });

      toast.success(`Project "${newProjectName}" created`);
      setIsOpen(false);
      setIsCreating(false);
      setNewProjectName("");
      setSelectedDirectory(null);
    } catch (error) {
      toast.error(`Failed to create project: ${error}`);
    }
  };

  const handleLoadRecentProject = async (projectPath: string) => {
    try {
      const projectJson = await invoke<string>("load_project_from_file", {
        filePath: projectPath,
      });

      const project: ProjectConfig = JSON.parse(projectJson);
      loadProject(project);
      toast.success(`Project "${project.name}" loaded`);
      setIsOpen(false);
    } catch (error) {
      toast.error(`Failed to load project: ${error}`);
    }
  };

  const handleRemoveRecent = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeRecentProject(id);
    toast.success("Removed from recent projects");
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 px-3">
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="text-sm">
            {currentProject ? currentProject.name : "Open Project"}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project Manager</DialogTitle>
          <DialogDescription>
            Create a new project or open a recent one
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Project */}
          {currentProject && (
            <Card className="border-primary">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{currentProject.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {currentProject.projectPath}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Last updated: {formatDate(currentProject.updatedAt)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      closeProject();
                      toast.success("Project closed");
                    }}
                  >
                    Close
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Create New Project */}
          {!isCreating ? (
            <Button
              onClick={() => setIsCreating(true)}
              variant="outline"
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Project
            </Button>
          ) : (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="project-name">Project Name</Label>
                  <Input
                    id="project-name"
                    placeholder="My CAN Project"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Project Directory</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Select a directory..."
                      value={selectedDirectory || ""}
                      readOnly
                      className="flex-1"
                    />
                    <Button onClick={handleSelectDirectory} variant="outline">
                      <Folder className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || !selectedDirectory}
                    className="flex-1"
                  >
                    Create
                  </Button>
                  <Button
                    onClick={() => {
                      setIsCreating(false);
                      setNewProjectName("");
                      setSelectedDirectory(null);
                    }}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Projects */}
          {recentProjects.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="w-4 h-4" />
                Recent Projects
              </div>
              <div className="space-y-2">
                {recentProjects.map((project) => (
                  <Card
                    key={project.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => handleLoadRecentProject(project.path)}
                  >
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-sm">
                            {project.name}
                          </h4>
                          <p className="text-xs text-muted-foreground truncate">
                            {project.path}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(project.lastOpened)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleRemoveRecent(project.id, e)}
                          className="h-8 w-8 p-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
