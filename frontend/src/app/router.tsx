import { Navigate, createBrowserRouter } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Overview } from "../screens/Overview";
import { RunWorkspace } from "../screens/RunWorkspace";
import { NewRun } from "../screens/NewRun";
import { NotFound } from "../screens/NotFound";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: "runs", element: <Navigate to="/runs/RUN-2048" replace /> },
      { path: "runs/new", element: <NewRun /> },
      { path: "runs/:runId", element: <RunWorkspace /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
