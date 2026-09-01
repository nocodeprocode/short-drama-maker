import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    window.location.replace("/new");
  }, []);
  return null;
}
