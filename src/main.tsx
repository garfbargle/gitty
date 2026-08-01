import React from "react";
import ReactDOM from "react-dom/client";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// The browser demo is intentionally separate from the native Tauri runtime.
if (import.meta.env.MODE === "demo") {
  void import("./WebDemo").then(({ default: WebDemo }) => {
    root.render(<React.StrictMode><WebDemo /></React.StrictMode>);
  });
} else {
  void import("./App").then(({ default: App }) => {
    root.render(<React.StrictMode><App /></React.StrictMode>);
  });
}
