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
import { useCANStore } from "@/store/canStore";
import { Plus, Trash2 } from "lucide-react";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Message Filtering</CardTitle>
        <CardDescription>
          Filter CAN messages by ID using whitelist or blacklist mode
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="filter-mode">Filter Mode</Label>
          <Select
            id="filter-mode"
            value={filterMode}
            onChange={(e) =>
              setFilterMode(
                e.target.value as "none" | "whitelist" | "blacklist"
              )
            }
          >
            <option value="none">None (Show All)</option>
            <option value="whitelist">Whitelist (Show Only Listed)</option>
            <option value="blacklist">Blacklist (Hide Listed)</option>
          </Select>
        </div>

        {filterMode !== "none" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="new-filter">Add CAN ID Filter (Hex)</Label>
              <div className="flex gap-2">
                <Input
                  id="new-filter"
                  placeholder="Enter CAN ID (e.g., 123)"
                  value={newFilterId}
                  onChange={(e) => setNewFilterId(e.target.value.toUpperCase())}
                  onKeyPress={handleKeyPress}
                />
                <Button onClick={handleAddFilter} size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Active Filters ({filterRules.length})</Label>
              {filterRules.length === 0 ? (
                <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 p-3 rounded-md border border-gray-200 dark:border-gray-700">
                  No filters configured. Add CAN IDs to filter messages.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-gray-50 dark:bg-gray-900/50">
                  {filterRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-800 rounded-md"
                    >
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => toggleFilterRule(rule.id)}
                        className="w-4 h-4"
                      />
                      <Input
                        value={rule.mask}
                        onChange={(e) =>
                          updateFilterRule(
                            rule.id,
                            e.target.value.toUpperCase()
                          )
                        }
                        className="flex-1 h-8 text-sm font-mono"
                      />
                      <Button
                        onClick={() => removeFilterRule(rule.id)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/50 p-3 rounded-md border border-gray-200 dark:border-gray-700">
              <p className="font-semibold mb-1 text-gray-900 dark:text-gray-100">
                Filter Modes:
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  <strong className="text-gray-900 dark:text-gray-100">
                    Whitelist:
                  </strong>{" "}
                  Only show messages with IDs that match the filter list
                </li>
                <li>
                  <strong className="text-gray-900 dark:text-gray-100">
                    Blacklist:
                  </strong>{" "}
                  Hide messages with IDs that match the filter list
                </li>
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
