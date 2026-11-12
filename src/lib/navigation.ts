import {
  Activity,
  BarChart3,
  BellRing,
  Clapperboard,
  Gift,
  Goal,
  LayoutDashboard,
  Link2,
  MessageSquare,
  MonitorPlay,
  RadioTower,
  Settings,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react";

export type NavigationGroup = "main" | "tools" | "insights" | "system";
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
  { id: "obs", label: "obs", icon: Clapperboard, group: "main" },
  { id: "chat", label: "chat", icon: MessageSquare, group: "main" },
  { id: "activitys", label: "activitys", icon: Activity, group: "main" },
  { id: "commands", label: "commands", icon: Terminal, group: "tools" },
  { id: "chatAlerts", label: "chatAlerts", icon: BellRing, group: "tools" },
  { id: "channelPoints", label: "channelPoints", icon: Sparkles, group: "tools" },
  { id: "giveaways", label: "giveaways", icon: Gift, group: "tools" },
  { id: "livePreview", label: "livePreview", icon: MonitorPlay, group: "insights" },
  { id: "statistics", label: "statistics", icon: BarChart3, group: "insights" },
  { id: "goals", label: "goals", icon: Goal, group: "insights" },
  { id: "connections", label: "connections", icon: Link2, group: "system" },
  { id: "settings", label: "settings", icon: Settings, group: "system" },
];

export const navigationGroups: NavigationGroup[] = ["main", "tools", "insights", "system"];
