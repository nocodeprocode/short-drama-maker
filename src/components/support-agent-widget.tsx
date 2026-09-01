import { createElement, useEffect } from "react";

const SCRIPT_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";
const SCRIPT_ID = "elevenlabs-convai-widget-embed";

export function SupportAgentWidget() {
  const agentId = import.meta.env.VITE_ELEVENLABS_AGENT_ID?.trim();

  useEffect(() => {
    if (!agentId || document.getElementById(SCRIPT_ID)) {
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.type = "text/javascript";
    document.body.appendChild(script);
  }, [agentId]);

  if (!agentId) {
    return null;
  }

  return createElement("elevenlabs-convai", {
    "agent-id": agentId,
    variant: "compact",
    "action-text": "Ask about Short Drama Maker",
    "start-call-text": "Start call",
    "end-call-text": "End call",
    "listening-text": "Listening",
    "speaking-text": "Alexis is speaking",
    dismissible: true,
  });
}
