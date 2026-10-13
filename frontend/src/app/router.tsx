import { Navigate, createBrowserRouter } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Overview } from "../screens/Overview";
import { RunWorkspace } from "../screens/RunWorkspace";
import { NewRun } from "../screens/NewRun";
import { Agents } from "../screens/Agents";
import { ProofDetail } from "../screens/ProofDetail";
import { Leaderboard } from "../screens/Leaderboard";
import { Integrations } from "../screens/Integrations";
import { Wallet } from "../screens/Wallet";
import { SignIn } from "../screens/SignIn";
import { NotFound } from "../screens/NotFound";

export const router = createBrowserRouter([
  { path: "/signin", element: <SignIn /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: "runs", element: <Navigate to="/runs/RUN-2048" replace /> },
      { path: "runs/new", element: <NewRun /> },
      { path: "runs/:runId", element: <RunWorkspace /> },
      { path: "agents", element: <Agents /> },
      { path: "proofs", element: <Navigate to="/proofs/1840" replace /> },
      { path: "proofs/:proofId", element: <ProofDetail /> },
      { path: "leaderboard", element: <Leaderboard /> },
      { path: "integrations", element: <Integrations /> },
      { path: "wallet", element: <Wallet /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
