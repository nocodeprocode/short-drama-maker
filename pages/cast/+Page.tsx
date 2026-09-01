import { useEffect } from "react";
import { navigate } from "vike/client/router";

export default function Page() {
  useEffect(() => {
    void navigate("/actors");
  }, []);
  return null;
}
