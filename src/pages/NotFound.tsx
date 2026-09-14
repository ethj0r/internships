import { Link } from "react-router";
import { EmptyState } from "../components/common";

export function NotFound() {
  return (
    <div className="page">
      <EmptyState
        icon="search"
        title="Page not found"
        message="This page doesn't exist or has moved."
        action={
          <Link to="/discover" className="btn">
            Go to Discover
          </Link>
        }
      />
    </div>
  );
}
