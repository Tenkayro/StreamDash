import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { RuntimeProvider } from "./services/runtime";
import { Toaster } from "sonner";
import { UpdateProvider } from "./services/updater";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UpdateProvider>
      <RuntimeProvider>
        <App />
        <Toaster theme="dark" position="bottom-right" richColors />
      </RuntimeProvider>
    </UpdateProvider>
  </StrictMode>,
);
