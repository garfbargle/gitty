import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { seedAndroidInsets } from "./lib/androidInsets";

// Before the first render, so the chrome is laid out inside the system bars on
// the first paint rather than jumping once React mounts.
seedAndroidInsets();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
