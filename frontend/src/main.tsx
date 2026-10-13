import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/onest/400.css";
import "@fontsource/onest/500.css";
import "@fontsource/onest/600.css";
import "@fontsource/onest/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/motion.css";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemeToggle } from "./components/ThemeToggle";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <h1 className="display">Mergit</h1>
      <ThemeToggle />
    </ThemeProvider>
  </StrictMode>,
);
