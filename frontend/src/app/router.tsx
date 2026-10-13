import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Overview } from "../screens/Overview";
import { NotFound } from "../screens/NotFound";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
