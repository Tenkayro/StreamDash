import {
  Activity,
  BarChart3,
  BellRing,
  Braces,
  Clapperboard,
  Gift,
  Goal,
  LayoutDashboard,
  Link2,
  MessageSquare,
  MonitorPlay,
  RadioTower,
  Settings,
  Smartphone,
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
  // Live workspace (used during stream)
  { id: "dashboard", label: "dashboard", icon: LayoutDashboard, group: "main" },
  { id: "stream", label: "stream", icon: RadioTower, group: "main" },
  { id: "livePreview", label: "livePreview", icon: MonitorPlay, group: "main" },
  { id: "chat", label: "chat", icon: MessageSquare, group: "main" },
  { id: "activitys", label: "activitys", icon: Activity, group: "main" },
  { id: "obs", label: "obs", icon: Clapperboard, group: "main" },
  // Automation & community tools
  { id: "commands", label: "commands", icon: Terminal, group: "tools" },
  { id: "variables", label: "variables", icon: Braces, group: "tools" },
  { id: "chatAlerts", label: "chatAlerts", icon: BellRing, group: "tools" },
  { id: "channelPoints", label: "channelPoints", icon: Sparkles, group: "tools" },
  { id: "giveaways", label: "giveaways", icon: Gift, group: "tools" },
  // Analytics & targets
  { id: "statistics", label: "statistics", icon: BarChart3, group: "insights" },
  { id: "goals", label: "goals", icon: Goal, group: "insights" },
  // Setup & configuration
  { id: "connections", label: "connections", icon: Link2, group: "system" },
  { id: "host", label: "host", icon: Smartphone, group: "system" },
  { id: "settings", label: "settings", icon: Settings, group: "system" },
];

export const navigationGroups: NavigationGroup[] = ["main", "tools", "insights", "system"];
