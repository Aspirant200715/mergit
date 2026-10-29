import { useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "../../../app/paths";
import { createPlan } from "../../../api/client";
import { parseUsdc } from "../../../chain/funding";
import { Icon } from "../../../components/Icon";
import { PageHeader } from "../../../components/PageHeader";
import { TextAreaField, TextField } from "./fields";
import { Problems } from "./Problems";
import { useSubmit } from "./useSubmit";
import "../../../styles/screens/live-run.css";

const GOAL_LIMIT = 8000;

type Fields = { goal: string; repoUrl: string; ref: string; budget: string; category: string };

const INITIAL: Fields = { goal: "", repoUrl: "", ref: "main", budget: "5", category: "test-repair" };

/** Problems the form can catch itself; the API checks the repository, branch and category again. */
function fieldProblems(f: Fields): string[] {
  const problems: string[] = [];
  if (!f.goal.trim()) problems.push("Describe the goal.");
  if (!f.repoUrl.trim()) problems.push("Give the repository's https URL.");
  if (!f.ref.trim()) problems.push("Give the branch, tag or commit to start from.");
  const budget = parseUsdc(f.budget);
  if (budget === null || budget <= 0n) problems.push("The budget must be a positive USDC amount.");
  return problems;
}

/** New run on live data: the planner drafts tasks from the goal, then the requester reviews them. */
export function LiveNewRun() {
  const navigate = useNavigate();
  const [fields, setFields] = useState<Fields>(INITIAL);
  const { busy, problems, setProblems, submit } = useSubmit();

  const set = (key: keyof Fields) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const local = fieldProblems(fields);
    if (local.length > 0) {
      setProblems(local);
      return;
    }
    void submit(async () => {
      const plan = await createPlan({
        goal: fields.goal.trim(),
        repo_url: fields.repoUrl.trim(),
        ref: fields.ref.trim(),
        budget_usdc_units: (parseUsdc(fields.budget) ?? 0n).toString(),
        category: fields.category.trim(),
      });
      await navigate(paths.run(plan.plan_uuid));
    });
  };

  return (
    <>
      <PageHeader
        title="New run"
        subtitle="Describe what should be true when the run is done. Mergit drafts the tasks and a check for each; you review them before anything is paid."
      />
      <form className="card pad24 col g16 lr-form" onSubmit={onSubmit} noValidate>
        <TextAreaField
          label="Goal"
          value={fields.goal}
          onChange={set("goal")}
          maxLength={GOAL_LIMIT}
          placeholder="The refund test in payments/ passes again"
        />
        <div className="lr-form-grid">
          <TextField
            label="Repository"
            value={fields.repoUrl}
            onChange={set("repoUrl")}
            placeholder="https://github.com/acme/widgets"
          />
          <TextField label="Branch" value={fields.ref} onChange={set("ref")} />
          <TextField label="Budget (USDC)" value={fields.budget} onChange={set("budget")} inputMode="decimal" />
          <TextField label="Category" value={fields.category} onChange={set("category")} />
        </div>
        <Problems items={problems} />
        <div className="row g12 lr-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name="sparkle" size={16} />
            {busy ? "Planning…" : "Draft the plan"}
          </button>
          <span className="small c3">Nothing is paid until you approve and fund the plan.</span>
        </div>
      </form>
    </>
  );
}
