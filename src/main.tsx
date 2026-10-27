import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
import { RuntimeProvider } from "./services/runtime";
import { Toaster } from "sonner";
import { UpdateProvider } from "./services/updater";
import { TrayBridge, TrayPanel } from "./components/TrayPanel";

const trayWindow = new URLSearchParams(window.location.search).has("tray");
if (trayWindow) document.documentElement.classList.add("tray-window");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {trayWindow ? (
      <TrayPanel />
    ) : (
      <UpdateProvider>
        <RuntimeProvider>
          <TrayBridge />
          <App />
          <Toaster theme="dark" position="bottom-right" richColors />
        </RuntimeProvider>
      </UpdateProvider>
    )}
  </StrictMode>,
);
