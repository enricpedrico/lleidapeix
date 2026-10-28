import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/newsreader";
import App from "./App";
import { NotationProvider } from "./notation";
import "./styles.css";
import "./table.css";
import "./traditional-deck.css";
import "./trump.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NotationProvider>
      <App />
    </NotationProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
