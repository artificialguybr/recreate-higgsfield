import { Navigate, useSearchParams } from "react-router-dom";
import Launchframe from "../Launchframe";

export default function LaunchframeMockup() {
  const [searchParams] = useSearchParams();

  if (searchParams.get("mockup") !== "1") {
    return <Navigate replace to="?mockup=1" />;
  }

  return <Launchframe />;
}
