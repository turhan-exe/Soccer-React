// main.tsx / index.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { markStartupTiming } from "@/services/startupTiming";

markStartupTiming("js_entry");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>

    <App />
  </React.StrictMode>,
);
