import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/roboto";
import "@fontsource-variable/roboto-mono";
import "./index.css";
import App from "../FlightOps-UAS.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
