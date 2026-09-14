import { useNavigate, useParams } from "react-router";
import { JobDetailView } from "../components/JobDetailView";
import { useDocumentTitle } from "../lib/hooks";

export function JobPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  useDocumentTitle("Internship");
  const id = Number(jobId);
  return (
    <div className="split-detail" style={{ flex: 1 }}>
      <JobDetailView key={id} jobId={id} backAlways backLabel="Back" onBack={() => (window.history.length > 1 ? navigate(-1) : navigate("/pipeline"))} />
    </div>
  );
}
