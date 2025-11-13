import { useState } from "react";
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
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useCANStore } from "@/store/canStore";
import { Plus, Trash2, Filter, List, Ban, Shield } from "lucide-react";

export function CANMessageFilter() {
  const {
    filterMode,
    filterRules,
    setFilterMode,
    addFilterRule,
    removeFilterRule,
    toggleFilterRule,
    updateFilterRule,
  } = useCANStore();

  const [newFilterId, setNewFilterId] = useState("");

  const handleAddFilter = () => {
    if (!newFilterId) {
      toast.error("Please enter a CAN ID");
      return;
    }

    const idNum = parseInt(newFilterId, 16);
    if (isNaN(idNum)) {
      toast.error("Invalid CAN ID (must be hexadecimal)");
      return;
    }

    addFilterRule({
      id: crypto.randomUUID(),
      mask: newFilterId.toUpperCase(),
      enabled: true,
    });
    toast.success(`Filter added: ${newFilterId.toUpperCase()}`);
    setNewFilterId("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddFilter();
    }
  };

  const getFilterModeIcon = (mode: string) => {
  switch (mode) {
    case "whitelist":
      return <List className="w-4 h-4" />;
    case "blacklist":
      return <Ban className="w-4 h-4" />;
    default:
      return <Filter className="w-4 h-4" />;
  }
};

const getFilterModeBadge = (mode: string) => {
  switch (mode) {
    case "whitelist":
      return <Badge variant="success" className="text-xs">Whitelist</Badge>;
    case "blacklist":
      return <Badge variant="destructive" className="text-xs">Blacklist</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">Disabled</Badge>;
  }
};

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Message Filtering
            </CardTitle>
            <CardDescription>
              Filter CAN messages by ID using whitelist or blacklist mode
            </CardDescription>
          </div>
          {getFilterModeBadge(filterMode)}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="filter-mode" className="text-sm font-medium">
            Filter Mode
          </Label>
          <Select
            id="filter-mode"
            value={filterMode}
            onChange={(e) =>
              setFilterMode(
                e.target.value as "none" | "whitelist" | "blacklist"
              )
            }
          >
            <option value="none">Show All Messages</option>
            <option value="whitelist">Whitelist Mode (Show Only Listed IDs)</option>
            <option value="blacklist">Blacklist Mode (Hide Listed IDs)</option>
          </Select>
        </div>

        {filterMode !== "none" && (
          <>
            <Separator />

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-filter" className="text-sm font-medium flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add CAN ID Filter
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="new-filter"
                    placeholder="Enter CAN ID (e.g., 123)"
                    value={newFilterId}
                    onChange={(e) => setNewFilterId(e.target.value.toUpperCase())}
                    onKeyPress={handleKeyPress}
                    className="font-mono"
                  />
                  <Button onClick={handleAddFilter} size="sm" className="px-4">
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter hexadecimal CAN ID to filter messages
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    Active Filters
                  </Label>
                  <Badge variant="outline" className="text-xs">
                    {filterRules.filter(r => r.enabled).length} enabled
                  </Badge>
                </div>

                {filterRules.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 p-6 rounded-md border border-dashed bg-muted/20">
                    <Filter className="w-5 h-5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No filters configured. Add CAN IDs to filter messages.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2 bg-background">
                    {filterRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex items-center gap-3 p-3 rounded-md bg-card border hover:bg-accent/50 transition-colors"
                      >
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={() => toggleFilterRule(rule.id)}
                        />
                        <div className="flex-1">
                          <Input
                            value={rule.mask}
                            onChange={(e) =>
                              updateFilterRule(
                                rule.id,
                                e.target.value.toUpperCase()
                              )
                            }
                            className="font-mono text-sm h-8"
                            disabled={!rule.enabled}
                          />
                        </div>
                        <Button
                          onClick={() => removeFilterRule(rule.id)}
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 hover:bg-destructive/20 hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div className="p-4 rounded-md bg-muted/30 border space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {getFilterModeIcon(filterMode)}
                  Filter Mode Information
                </div>
                <div className="space-y-2 text-sm">
                  {filterMode === "whitelist" ? (
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full mt-1.5 flex-shrink-0"></div>
                      <div>
                        <p className="font-medium text-green-700 dark:text-green-300">Whitelist Mode</p>
                        <p className="text-muted-foreground">
                          Only show messages with IDs that match the filter list. All other messages will be hidden.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full mt-1.5 flex-shrink-0"></div>
                      <div>
                        <p className="font-medium text-red-700 dark:text-red-300">Blacklist Mode</p>
                        <p className="text-muted-foreground">
                          Hide messages with IDs that match the filter list. All other messages will be shown.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
