import "./Layout.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="app">{children}</div>;
}
