import {
  Activity,
  BarChart3,
  Goal,
  LayoutDashboard,
  Link2,
  MessageSquare,
  MonitorPlay,
  RadioTower,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavigationGroup = "main" | "insights" | "system";
export const OPEN_COMMAND_PALETTE = "streamdash:open-command-palette";

export type NavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  group: NavigationGroup;
};

export const navigationItems: NavigationItem[] = [
  { id: "dashboard", label: "dashboard", icon: LayoutDashboard, group: "main" },
  { id: "stream", label: "stream", icon: RadioTower, group: "main" },
  { id: "chat", label: "chat", icon: MessageSquare, group: "main" },
  { id: "activity", label: "activity", icon: Activity, group: "main" },
  { id: "livePreview", label: "livePreview", icon: MonitorPlay, group: "insights" },
  { id: "statistics", label: "statistics", icon: BarChart3, group: "insights" },
  { id: "goals", label: "goals", icon: Goal, group: "insights" },
  { id: "connections", label: "connections", icon: Link2, group: "system" },
  { id: "settings", label: "settings", icon: Settings, group: "system" },
];

export const navigationGroups: NavigationGroup[] = ["main", "insights", "system"];
