import { Button } from "../components/ui";

export function NotFound() {
  return (
    <div className="col g12" style={{ alignItems: "center", textAlign: "center", paddingTop: 80 }}>
      <span className="mono c3">404</span>
      <h1 className="display">Nothing settled here</h1>
      <p className="c2">This page does not exist yet.</p>
      <Button variant="p" to="/">
        Back to overview
      </Button>
    </div>
  );
}
