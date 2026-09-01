import type { Config } from "vike/types";
import vikeReact from "vike-react/config";

const config: Config = {
  title: "Drama Space",
  description: "Story in, episodes out. Vertical short-drama series with a locked cast.",
  ssr: true,
  server: true,
  extends: [vikeReact],
};

export default config;
