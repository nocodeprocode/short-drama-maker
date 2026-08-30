import type { Config } from "vike/types";
import vikeReact from "vike-react/config";

const config: Config = {
  title: "Hello World",
  description: "A Vike + React + Vite hello-world demo with server-side rendering.",
  ssr: true,
  extends: [vikeReact],
};

export default config;
